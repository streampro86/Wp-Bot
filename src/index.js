import express from "express";
import pino from "pino";
import makeWASocket, {
  Browsers,
  DisconnectReason,
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
const pluginModules = new Map();

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
      pluginModules.set(file.replace(/\.js$/, ""), imported.default);
      addLog("info", `Loaded plugin: ${imported.default.name || file}`);
    } catch (error) {
      addLog("error", `Plugin load failed (${file}): ${error.message}`);
    }
  }
  addLog("info", `Plugin loader ready: ${pluginModules.size} plugin(s)`);
}

async function handleIncomingMessage(message) {
  if (!message?.message || message.key?.fromMe) return;
  const remoteJid = message.key?.remoteJid;
  if (!remoteJid) return;

  // This starter is intended for group chats. Private chats are ignored by default.
  if (!remoteJid.endsWith("@g.us")) return;

  const content = message.message.conversation
    || message.message.extendedTextMessage?.text
    || message.message.imageMessage?.caption
    || message.message.videoMessage?.caption
    || "";
  const body = safeText(content);
  if (!body.startsWith(config.prefix)) return;

  const [command, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
  if (!command) return;
  const context = {
    sock,
    message,
    remoteJid,
    sender: message.key.participant || message.key.remoteJid,
    body,
    command: command.toLowerCase(),
    args,
    config,
    addLog
  };

  for (const [key, plugin] of pluginModules.entries()) {
    if (config.plugins[key] === false) continue;
    try {
      const commands = (plugin.commands || []).map((c) => String(c).toLowerCase());
      if (commands.includes(context.command)) {
        await plugin.execute(context);
        return;
      }
    } catch (error) {
      addLog("error", `Command !${context.command} failed: ${error.message}`);
      await sock.sendMessage(remoteJid, { text: "⚠️ Command failed. Admin can check dashboard logs." });
      return;
    }
  }
}

async function startWhatsApp() {
  if (reconnecting) return;
  reconnecting = true;
  try {
    fs.mkdirSync(config.sessionDirectory, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(config.sessionDirectory);
    authStateRef = state;
    sock = makeWASocket({
      auth: state,
      logger,
      browser: Browsers.ubuntu(config.botName),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
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
        const loggedOut = code === DisconnectReason.loggedOut;
        setBotState({ connection: loggedOut ? "logged_out" : "disconnected", connected: false });
        addLog("warn", `WhatsApp connection closed (code: ${code ?? "unknown"})`);
        if (!loggedOut) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            reconnecting = false;
            startWhatsApp().catch((e) => addLog("error", `Reconnect failed: ${e.message}`));
          }, 3000);
        }
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

export async function requestPairingCode(phoneNumber) {
  const clean = String(phoneNumber || "").replace(/\D/g, "");
  if (clean.length < 8 || clean.length > 15) {
    throw new Error("Enter an international number with country code, digits only (Bangladesh example: 8801XXXXXXXXX).");
  }
  if (getBotState().connected) throw new Error("WhatsApp is already connected.");
  if (!sock) throw new Error("WhatsApp client is starting. Wait 10 seconds and try again.");
  if (pairingRequestInProgress) throw new Error("Pairing code request is already running. Wait a few seconds.");
  if (authStateRef?.creds?.registered) {
    throw new Error("This session is already linked to a WhatsApp account. Use the existing session, or clear the session folder only if you want to link a different account.");
  }

  pairingRequestInProgress = true;
  loginMode = "pairing";
  qrData = null;
  pairingCode = null;
  setBotState({ connection: "waiting_for_pairing", connected: false });
  addLog("info", "Pairing-code request started");
  try {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!sock || getBotState().connected) throw new Error("WhatsApp socket state changed. Refresh dashboard and retry.");
    const code = await sock.requestPairingCode(clean);
    pairingCode = code;
    qrData = null;
    addLog("success", "Pairing code generated successfully. Enter it immediately in WhatsApp.");
    return code;
  } catch (error) {
    pairingRequestInProgress = false;
    loginMode = "qr";
    setBotState({ connection: "waiting_for_qr", connected: false });
    addLog("error", `Pairing code generation failed: ${error?.message || error}`);
    throw new Error(`Could not generate pairing code: ${error?.message || error}`);
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
  addLog
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
