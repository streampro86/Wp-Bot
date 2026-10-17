import express from "express";
import pino from "pino";
import { MongoClient } from "mongodb";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  BufferJSON,
  proto,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import config from "../config.js";
import { createDashboard } from "./web/dashboard.js";
import { addLog, getLogs, setBotState, getBotState } from "./utils/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginsDir = path.resolve(__dirname, "../plugins");
const logger = pino({ level: "silent" });
let sock;
let reconnectTimer;
let reconnecting = false;
let qrData = null;
let pairingCode = null;
let loginMode = "qr";
let pairingRequestInProgress = false;
let authStateRef = null;
let mongoClient = null;
let mongoAuthCollection = null;
let mongoSettingsCollection = null;
const pluginModules = new Map();
let mongoDb = null;


// MongoDB-backed Baileys auth storage works on Render Free without a persistent disk.
// Create a free MongoDB Atlas database and put its URI in config.js.
async function useMongoAuthState() {
  if (!config.mongoUri || !String(config.mongoUri).startsWith("mongodb")) {
    throw new Error("MongoDB auth storage is enabled but config.mongoUri is missing. Add your MongoDB Atlas URI in config.js.");
  }
  if (!mongoClient) {
    mongoClient = new MongoClient(config.mongoUri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 5
    });
    await mongoClient.connect();
  }
  const db = mongoClient.db(config.mongoDbName || "mahadi_whatsapp_bot");
  mongoDb = db;
  mongoAuthCollection = db.collection(config.mongoAuthCollection || "baileys_auth");
  mongoSettingsCollection = db.collection("bot_settings");
  await db.collection("ai_memory").createIndex({ chatId: 1, senderId: 1, createdAt: -1 });
  await db.collection("learning_entries").createIndex({ chatId: 1, senderId: 1, createdAt: -1 });
  const savedPluginSettings = await mongoSettingsCollection.findOne({ _id: "plugins" });
  if (savedPluginSettings?.values && typeof savedPluginSettings.values === "object") {
    config.plugins = { ...config.plugins, ...savedPluginSettings.values };
    addLog("success", "Plugin settings restored from MongoDB");
  }

  const credsDoc = await mongoAuthCollection.findOne({ _id: "creds" });
  const creds = credsDoc?.data
    ? JSON.parse(credsDoc.data, BufferJSON.reviver)
    : initAuthCreds();

  const keys = {
    async get(type, ids) {
      if (!ids.length) return {};
      const docs = await mongoAuthCollection.find({
        _id: { $in: ids.map((id) => `${type}-${id}`) }
      }).toArray();
      const result = {};
      for (const doc of docs) {
        const id = doc._id.slice(type.length + 1);
        let value = JSON.parse(doc.data, BufferJSON.reviver);
        if (type === "app-state-sync-key") {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        result[id] = value;
      }
      return result;
    },
    async set(data) {
      const operations = [];
      for (const [type, entries] of Object.entries(data)) {
        for (const [id, value] of Object.entries(entries || {})) {
          const _id = `${type}-${id}`;
          if (value == null) operations.push({ deleteOne: { filter: { _id } } });
          else operations.push({
            updateOne: {
              filter: { _id },
              update: { $set: { data: JSON.stringify(value, BufferJSON.replacer), updatedAt: new Date() } },
              upsert: true
            }
          });
        }
      }
      if (operations.length) await mongoAuthCollection.bulkWrite(operations, { ordered: false });
    }
  };

  const state = {
    creds,
    keys
  };
  const saveCreds = async () => {
    await mongoAuthCollection.updateOne(
      { _id: "creds" },
      { $set: { data: JSON.stringify(creds, BufferJSON.replacer), updatedAt: new Date() } },
      { upsert: true }
    );
  };
  return { state, saveCreds };
}

function safeText(message) {
  return String(message ?? "").trim();
}

async function loadPlugins() {
  fs.mkdirSync(pluginsDir, { recursive: true });
  const entries = fs.readdirSync(pluginsDir).filter((f) => f.endsWith(".js"));
  for (const file of entries) {
    try {
      const moduleUrl = pathToFileURL(path.join(pluginsDir, file)).href + `?v=${Date.now()}`;
      const imported = await import(moduleUrl);
      if (!imported.default || typeof imported.default.execute !== "function") {
        addLog("warn", `Skipped ${file}: default export with execute() is required`);
        continue;
      }
      pluginModules.set(file.replace(/\.js$/, ""), { ...imported.default, handleAutoAI: imported.handleAutoAI, handleMessage: imported.handleMessage || imported.handleLearningMessage });
      addLog("info", `Loaded plugin: ${imported.default.name || file}`);
    } catch (error) {
      addLog("error", `Plugin load failed (${file}): ${error.message}`);
    }
  }
  addLog("info", `Plugin loader ready: ${pluginModules.size} plugin(s)`);
}

async function handleIncomingMessage(message) {
  if (!message?.message) return;
  // Baileys may emit the linked account's own messages only when emitOwnEvents is enabled.
  if (message.key?.fromMe && config.selfListen !== true) return;
  const remoteJid = message.key?.remoteJid;
  if (!remoteJid || remoteJid === "status@broadcast") return;

  if (config.groupOnly === true && !remoteJid.endsWith("@g.us")) return;

  const content = message.message.conversation
    || message.message.extendedTextMessage?.text
    || message.message.imageMessage?.caption
    || message.message.videoMessage?.caption
    || message.message.documentMessage?.caption
    || "";
  const body = safeText(content);
  if (!body) return;
  const senderJid = String(message.key.participant || message.key.remoteJid || "");

  // Interactive plugin handlers run before command parsing (e.g. numbered font/learning menus).
  for (const interactiveName of ["font", "learn"]) {
    try {
      const interactivePlugin = pluginModules.get(interactiveName);
      if (interactivePlugin?.handleMessage && await interactivePlugin.handleMessage({
        body, message, remoteJid, sock, mongoSettingsCollection, mongoDb, addLog
      })) return;
    } catch (error) {
      addLog("warn", `${interactiveName} menu handler failed: ${error.message}`);
    }
  }

  // Commands must be the first token in the message; text containing "ping" won't trigger.
  let commandLine = null;
  if (config.prefixEnabled !== false && config.prefix && body.startsWith(config.prefix)) {
    commandLine = body.slice(config.prefix.length).trim();
  } else if (config.noPrefixEnabled === true) {
    commandLine = body;
  } else {
    try { const ai = pluginModules.get("ai"); if (ai?.handleAutoAI) await ai.handleAutoAI({ body, remoteJid, sock, config, mongoSettingsCollection, mongoDb, message, sender: senderJid, commandHandled: false, addLog }); } catch (error) { addLog("warn", `Auto AI skipped: ${error.message}`); }
    return;
  }
  if (!commandLine) {
    try { const ai = pluginModules.get("ai"); if (ai?.handleAutoAI) await ai.handleAutoAI({ body, remoteJid, sock, config, mongoSettingsCollection, mongoDb, message, sender: senderJid, commandHandled: false, addLog }); } catch (error) { addLog("warn", `Auto AI skipped: ${error.message}`); }
    return;
  }
  const [command, ...args] = commandLine.split(/\s+/);
  if (!command) return;
  let isGroupAdmin = false;
  if (remoteJid.endsWith("@g.us")) {
    try {
      const metadata = await sock.groupMetadata(remoteJid);
      const senderId = String(message.key.participant || "").split(":")[0];
      isGroupAdmin = (metadata.participants || []).some((participant) =>
        String(participant.id || "").split(":")[0] === senderId && ["admin", "superadmin"].includes(participant.admin)
      );
    } catch (error) {
      addLog("debug", `Group admin lookup unavailable: ${error.message}`);
    }
  }
  const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
  // Multi-owner support (robust matching)
  const ownerList = new Set();
  const primary = String(config.ownerJid || process.env.OWNER_NUMBER || "").replace(/\D/g, "");
  if (primary) ownerList.add(primary);
  for (const n of (config.owners || [])) {
    const clean = String(n || "").replace(/\D/g, "");
    if (clean) ownerList.add(clean);
  }
  // Also accept numbers from OWNER_NUMBERS env at runtime (in case config was cached)
  for (const n of String(process.env.OWNER_NUMBERS || "").split(",")) {
    const clean = n.replace(/\D/g, "");
    if (clean) ownerList.add(clean);
  }

  function numberMatchesOwner(num) {
    if (!num) return false;
    if (ownerList.has(num)) return true;
    // Match last 10 digits (handles 8801... vs 01... vs missing country code)
    const tail = num.slice(-10);
    for (const own of ownerList) {
      if (own.slice(-10) === tail) return true;
      if (own === num || num.endsWith(own) || own.endsWith(num)) return true;
    }
    return false;
  }

  const isOwner = numberMatchesOwner(senderNumber);
  // Also treat the linked account itself as owner when selfListen is on
  const botOwnNumber = String(sock?.user?.id || "").split(":")[0].split("@")[0].replace(/\D/g, "");
  const isLinkedAccount = Boolean(botOwnNumber && (botOwnNumber === senderNumber || numberMatchesOwner(botOwnNumber) && message?.key?.fromMe));
  const finalIsOwner = isOwner || (config.selfListen && message?.key?.fromMe && numberMatchesOwner(botOwnNumber || senderNumber));

  const context = {
    sock,
    message,
    remoteJid,
    sender: senderJid,
    body,
    command: command.toLowerCase(),
    args,
    config,
    addLog,
    mongoSettingsCollection,
    mongoDb,
    isOwner: finalIsOwner,
    isAdmin: Boolean(finalIsOwner || isGroupAdmin),
    senderNumber,
    ownerList: [...ownerList]
  };

  let commandHandled = false;
  for (const [key, plugin] of pluginModules.entries()) {
    if (config.plugins[key] === false) continue;
    try {
      const commands = (plugin.commands || []).map((c) => String(c).toLowerCase());
      if (commands.includes(context.command)) {
        commandHandled = true;
        await plugin.execute(context);
        return;
      }
    } catch (error) {
      addLog("error", `Command !${context.command} failed: ${error.message}`);
      await sock.sendMessage(remoteJid, { text: "⚠️ Command failed. Admin can check dashboard logs." });
      return;
    }
  }
  try { const ai = pluginModules.get("ai"); if (ai?.handleAutoAI) await ai.handleAutoAI({ body, remoteJid, sock, config, mongoSettingsCollection, mongoDb, message, sender: senderJid, commandHandled, addLog }); } catch (error) { addLog("warn", `Auto AI skipped: ${error.message}`); }
}

async function startWhatsApp() {
  if (reconnecting) return;
  reconnecting = true;
  try {
    let state, saveCreds;
    if (config.authStorage === "mongodb") {
      ({ state, saveCreds } = await useMongoAuthState());
      addLog("info", "Authentication session storage: MongoDB Atlas (persistent on Render Free)");
    } else {
      fs.mkdirSync(config.sessionDirectory, { recursive: true });
      ({ state, saveCreds } = await useMultiFileAuthState(config.sessionDirectory));
      addLog("warn", "Authentication session storage: local filesystem; Render Free restarts/redeploys may erase login.");
    }
    authStateRef = state;
    let version;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;
      addLog("info", `Using WhatsApp Web protocol version ${version.join(".")}`);
    } catch (error) {
      addLog("warn", `Could not fetch latest WhatsApp Web version; using library default: ${error.message}`);
    }
    sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger,
      // A conventional desktop browser identity is more compatible with pairing-code login.
      browser: Browsers.macOS("Chrome"),
      printQRInTerminal: false,
      markOnlineOnConnect: true,
      // Ask Baileys to emit events for messages sent by the linked account too.
      emitOwnEvents: true,
      syncFullHistory: false
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr && loginMode !== "pairing" && !pairingRequestInProgress) {
        qrData = qr;
        setBotState({ connection: "waiting_for_qr", connected: false });
        addLog("info", "New QR code generated");
      }
      if (connection === "connecting") {
        setBotState({ connection: "connecting", connected: false });
      }
      if (connection === "open") {
        qrData = null;
        pairingCode = null;
        loginMode = "qr";
        pairingRequestInProgress = false;
        setBotState({ connection: "connected", connected: true, connectedAt: new Date().toISOString() });
        addLog("success", `WhatsApp connected as ${config.botName}`);
      }
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const requiresFreshLogin = code === DisconnectReason.loggedOut || code === 401;
        const restartRequired = code === DisconnectReason.restartRequired;
        const errorMessage = lastDisconnect?.error?.message || "No error message";
        setBotState({ connection: requiresFreshLogin ? "relogin_required" : "disconnected", connected: false });
        addLog("warn", `WhatsApp connection closed (code: ${code ?? "unknown"}; ${errorMessage})`);
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(async () => {
          try {
            if (requiresFreshLogin) {
              addLog("warn", "WhatsApp rejected the saved session; clearing stale auth and preparing a fresh QR/pairing login");
              await clearStoredAuthSession();
            }
            reconnecting = false;
            await startWhatsApp();
          } catch (e) {
            reconnecting = false;
            addLog("error", `Reconnect failed: ${e.message}`);
          }
        }, requiresFreshLogin ? 1000 : restartRequired ? 250 : 2500);
      }
    });
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) await handleIncomingMessage(message);
    });
  } catch (error) {
    addLog("error", `WhatsApp startup failed: ${error.message}`);
    setBotState({ connection: "error", connected: false });
  } finally {
    reconnecting = false;
  }
}

async function clearStoredAuthSession() {
  if (config.authStorage === "mongodb") {
    if (!mongoAuthCollection) await useMongoAuthState();
    await mongoAuthCollection.deleteMany({});
  } else {
    fs.rmSync(config.sessionDirectory, { recursive: true, force: true });
  }
  authStateRef = null;
  qrData = null;
  pairingCode = null;
  loginMode = "qr";
  pairingRequestInProgress = false;
}

async function stopCurrentSocket() {
  clearTimeout(reconnectTimer);
  reconnecting = true;
  const current = sock;
  sock = null;
  if (current) {
    try { current.ev.removeAllListeners("connection.update"); } catch {}
    try { current.ev.removeAllListeners("messages.upsert"); } catch {}
    try { current.ev.removeAllListeners("creds.update"); } catch {}
    try { current.end(new Error("Dashboard requested session reset")); } catch {}
  }
  setBotState({ connection: "logged_out", connected: false, connectedAt: null });
}

export async function dashboardLogout() {
  clearTimeout(reconnectTimer);
  reconnecting = true;
  const current = sock;
  sock = null;
  if (current) {
    // Prevent the socket's close event from scheduling a second reconnect during a dashboard logout.
    try { current.ev.removeAllListeners("connection.update"); } catch {}
    try { current.ev.removeAllListeners("messages.upsert"); } catch {}
    try { current.ev.removeAllListeners("creds.update"); } catch {}
    try { await current.logout(); } catch (error) { addLog("warn", `Remote logout response: ${error.message}`); }
    try { current.end(new Error("Logged out from dashboard")); } catch {}
  }
  await clearStoredAuthSession();
  setBotState({ connection: "logged_out", connected: false, connectedAt: null });
  addLog("success", "WhatsApp logged out from dashboard; saved authentication session cleared");
  reconnecting = false;
  setTimeout(() => startWhatsApp().catch((error) => addLog("error", `Restart after logout failed: ${error.message}`)), 500);
  return true;
}

export async function dashboardDeleteSession() {
  await stopCurrentSocket();
  await clearStoredAuthSession();
  addLog("warn", "Saved WhatsApp session deleted from dashboard; new QR/pairing login required");
  reconnecting = false;
  setTimeout(() => startWhatsApp().catch((error) => addLog("error", `Restart after session deletion failed: ${error.message}`)), 500);
  return true;
}

export async function requestPairingCode(phoneNumber) {
  const clean = String(phoneNumber || "").replace(/\D/g, "");
  if (clean.length < 10 || clean.length > 15) {
    throw new Error("Enter full international number with country code, digits only. Bangladesh example: 8801XXXXXXXXX (no + or 0 at start).");
  }
  // Common mistake: starting with 01 instead of 8801
  if (clean.startsWith("01") && clean.length === 11) {
    throw new Error("Number looks local (01...). Use country code: 8801XXXXXXXXX");
  }
  if (getBotState().connected) throw new Error("WhatsApp is already connected. Logout first if you want to link a different account.");
  if (!sock) throw new Error("WhatsApp client is still starting. Wait 10–15 seconds, refresh dashboard, then try again.");
  if (pairingRequestInProgress) throw new Error("A pairing request is already running. Wait 20 seconds before trying again.");
  if (authStateRef?.creds?.registered) {
    throw new Error("This session is already linked. Use "Delete saved session" first if you want to link a different number.");
  }

  pairingRequestInProgress = true;
  loginMode = "pairing";
  qrData = null;
  pairingCode = null;
  setBotState({ connection: "waiting_for_pairing", connected: false });
  addLog("info", `Pairing-code request started for ${clean.slice(0, 4)}****${clean.slice(-3)}`);

  try {
    // Wait until socket is ready enough (Baileys needs an open-ish connection state)
    let attempts = 0;
    while (attempts < 12) {
      if (!sock) throw new Error("Socket disappeared. Refresh and retry.");
      if (getBotState().connected) throw new Error("Already connected.");
      if (authStateRef?.creds?.registered) throw new Error("Session registered while waiting.");
      // Give Baileys time to finish initial handshake
      await new Promise((r) => setTimeout(r, 800));
      attempts += 1;
      // After a few waits, try requesting
      if (attempts >= 3) break;
    }

    if (!sock.requestPairingCode) {
      throw new Error("This Baileys build does not support pairing codes. Use QR login instead.");
    }

    const rawCode = await sock.requestPairingCode(clean);
    // Normalize display: ABCDEFGH -> ABCD-EFGH
    const digits = String(rawCode || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    const formatted = digits.length === 8
      ? `${digits.slice(0, 4)}-${digits.slice(4)}`
      : digits || rawCode;

    pairingCode = formatted;
    qrData = null;
    addLog("success", `Pairing code ready: ${formatted}. Enter it NOW in WhatsApp (code expires quickly).`);
    // Auto-clear flag after a while so user can retry
    setTimeout(() => {
      if (pairingRequestInProgress && !getBotState().connected) {
        pairingRequestInProgress = false;
      }
    }, 90000);
    return formatted;
  } catch (error) {
    pairingRequestInProgress = false;
    loginMode = "qr";
    pairingCode = null;
    setBotState({ connection: "waiting_for_qr", connected: false });
    const msg = error?.message || String(error);
    addLog("error", `Pairing failed: ${msg}`);
    // Friendlier hints for common WhatsApp rejections
    if (/rate|too many|try again/i.test(msg)) {
      throw new Error("WhatsApp rate-limited pairing. Wait 2–3 minutes, then try QR login instead.");
    }
    throw new Error(`Pairing failed: ${msg}. Tip: delete saved session, wait 30s, then use QR login (more reliable).`);
  }
}

export function getLoginArtifacts() {
  return { qr: qrData, pairingCode };
}

await loadPlugins();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
createDashboard(app, {
  config,
  getLoginArtifacts,
  requestPairingCode,
  pluginModules,
  getLogs,
  getBotState,
  getMongoSettingsCollection: () => mongoSettingsCollection,
  getMongoDb: () => mongoDb,
  getBotIdentity: () => sock?.user ? {
    id: sock.user.id || null,
    name: sock.user.name || null,
    platform: sock.user.platform || null
  } : null,
  dashboardLogout,
  dashboardDeleteSession,
  addLog,
  savePluginSetting: async (key, enabled) => {
    if (!mongoSettingsCollection) throw new Error("MongoDB is not connected yet");
    await mongoSettingsCollection.updateOne(
      { _id: "plugins" },
      { $set: { [`values.${key}`]: Boolean(enabled), updatedAt: new Date() } },
      { upsert: true }
    );
  }
});

app.listen(config.port, "0.0.0.0", () => {
  addLog("success", `Dashboard server listening on port ${config.port}`);
  console.log(`${config.botName} dashboard listening on port ${config.port}`);
  startWhatsApp();
});

process.on("uncaughtException", (error) => {
  addLog("error", `Uncaught exception: ${error.message}`);
});
process.on("unhandledRejection", (error) => {
  addLog("error", `Unhandled rejection: ${error?.message || error}`);
});

process.on("SIGTERM", async () => {
  try { if (sock) sock.end(undefined); } catch {}
  try { if (mongoClient) await mongoClient.close(); } catch {}
  process.exit(0);
});
process.on("SIGINT", async () => {
  try { if (sock) sock.end(undefined); } catch {}
  try { if (mongoClient) await mongoClient.close(); } catch {}
  process.exit(0);
});
