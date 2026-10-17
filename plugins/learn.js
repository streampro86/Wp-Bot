const pendingMenus = new Map();
const MAX_ENTRIES = 80;
const MENU_TTL_MS = 60_000;

function makeKey(chatId, senderId) { return `${chatId}:${senderId}`; }
function cleanText(text) { return String(text || "").trim().slice(0, 1200); }
function normId(v) {
  const s = String(v || "");
  return s.split("@")[0].split(":")[0].replace(/\D/g, "") || s.split(":")[0];
}
async function removeMessage(sock, chatId, key) {
  if (!key) return;
  try { await sock.sendMessage(chatId, { delete: key }); } catch { /* ignore */ }
}

export async function handleLearningMessage({ body, message, remoteJid, sock, mongoSettingsCollection, mongoDb, addLog }) {
  const senderId = normId(message?.key?.participant || message?.key?.remoteJid || "");
  const pendingKey = makeKey(remoteJid, senderId);
  const pending = pendingMenus.get(pendingKey);
  if (pending && Date.now() <= pending.expiresAt) {
    const quotedId = message?.message?.extendedTextMessage?.contextInfo?.stanzaId;
    if (quotedId === pending.menuKey?.id) {
      const choice = Number(String(body).trim());
      const row = pending.entries[choice - 1];
      if (row) {
        pendingMenus.delete(pendingKey);
        await removeMessage(sock, remoteJid, pending.menuKey);
        await removeMessage(sock, remoteJid, message?.key);
        await sock.sendMessage(remoteJid, {
          text: `🧠 *Learned #${choice}*\n${row.text}\n\nBy: ${row.senderId}\n${new Date(row.createdAt).toLocaleString()}`
        });
        return true;
      }
    }
  }

  if (!mongoDb || !body || message?.key?.fromMe) return false;
  if (/^(?:!|learn\b|ai\b|font\b|ping\b|help\b|status\b|alive\b|menu\b|owner\b)/i.test(body)) return false;

  const settings = await mongoSettingsCollection?.findOne({ _id: "learning" });
  if (settings?.enabled !== true) return false;

  // When learning is ON: save automatically (no separate opt-in required)
  await mongoDb.collection("learning_entries").insertOne({
    chatId: remoteJid,
    senderId,
    text: cleanText(body),
    scope: "user",
    createdAt: new Date()
  });
  const old = await mongoDb.collection("learning_entries")
    .find({ chatId: remoteJid, senderId })
    .sort({ createdAt: -1 })
    .skip(MAX_ENTRIES)
    .project({ _id: 1 })
    .toArray();
  if (old.length) await mongoDb.collection("learning_entries").deleteMany({ _id: { $in: old.map((x) => x._id) } });
  addLog?.("info", `Learning saved [${senderId}]: ${cleanText(body).slice(0, 50)}`);
  return false;
}

export const handleMessage = handleLearningMessage;

export default {
  name: "AI Learning & Memory",
  commands: ["learn"],
  aliases: ["learning"],
  category: "AI",
  author: "Mahadi Hasan",
  description: "Learn from chat and feed notes to AI",
  usage: "!learn on/off/status | add <text> | list | forget",
  async execute(ctx) {
    const { sock, remoteJid, args, message, sender, mongoDb, mongoSettingsCollection, addLog } = ctx;
    if (!mongoDb || !mongoSettingsCollection) throw new Error("MongoDB is required for learning");
    const action = String(args[0] || "help").toLowerCase();
    const senderId = normId(sender || remoteJid);
    const collection = mongoDb.collection("learning_entries");

    if (["on", "off"].includes(action)) {
      if (!ctx.isOwner) {
        await sock.sendMessage(remoteJid, {
          text: "🔒 Access nai.\nLearning ON/OFF shudhu *Owner*."
        }, { quoted: message });
        return;
      }
      await mongoSettingsCollection.updateOne(
        { _id: "learning" },
        { $set: { enabled: action === "on", updatedAt: new Date() } },
        { upsert: true }
      );
      addLog?.("info", `Learning global ${action}`);
      await sock.sendMessage(remoteJid, {
        text: action === "on"
          ? "🧠 Learning *ON*\nEkhon normal messages save hobe + AI use korbe.\nImportant fact: `!learn add <text>`"
          : "🧠 Learning *OFF*"
      }, { quoted: message });
      return;
    }

    if (action === "status") {
      const state = await mongoSettingsCollection.findOne({ _id: "learning" });
      const count = await collection.countDocuments({ chatId: remoteJid });
      const mine = await collection.countDocuments({ chatId: remoteJid, senderId });
      await sock.sendMessage(remoteJid, {
        text: [
          "🧠 *Learning Status*",
          `Global: ${state?.enabled ? "ON ✅" : "OFF"}`,
          `This chat entries: ${count}`,
          `Your entries: ${mine}`
        ].join("\n")
      }, { quoted: message });
      return;
    }

    if (action === "add") {
      const text = cleanText(args.slice(1).join(" "));
      if (!text) {
        await sock.sendMessage(remoteJid, { text: "Usage: !learn add <tothyo>" }, { quoted: message });
        return;
      }
      await collection.insertOne({
        chatId: remoteJid,
        senderId,
        text,
        scope: "chat",
        source: "explicit",
        createdAt: new Date()
      });
      addLog?.("info", `Learning explicit add: ${text.slice(0, 50)}`);
      await sock.sendMessage(remoteJid, {
        text: `✅ Save hoyeche. AI ei chat e eta use korbe:\n_${text.slice(0, 200)}_`
      }, { quoted: message });
      return;
    }

    if (action === "forget") {
      await collection.deleteMany({ chatId: remoteJid, senderId });
      await sock.sendMessage(remoteJid, { text: "🧹 Tomar learning entries delete." }, { quoted: message });
      return;
    }

    if (action === "list") {
      const entries = await collection.find({ chatId: remoteJid }).sort({ createdAt: -1 }).limit(12).toArray();
      if (!entries.length) {
        await sock.sendMessage(remoteJid, {
          text: "📭 Konо entry nai.\n!learn on\n!learn add <text>"
        }, { quoted: message });
        return;
      }
      const menu = [
        "🧠 *Learning entries*",
        ...entries.map((e, i) => `${i + 1}. ${String(e.text).slice(0, 90)}`),
        "",
        "Number e reply dile details (60s)."
      ].join("\n");
      const sent = await sock.sendMessage(remoteJid, { text: menu }, { quoted: message });
      pendingMenus.set(makeKey(remoteJid, senderId), {
        menuKey: sent?.key,
        entries,
        expiresAt: Date.now() + MENU_TTL_MS
      });
      return;
    }

    // optin/optout kept as aliases but optional now
    if (action === "optin" || action === "optout") {
      await sock.sendMessage(remoteJid, {
        text: "ℹ️ Opt-in ar dorkar nai.\nOwner `!learn on` korle auto save hoy.\nFact add: `!learn add <text>`"
      }, { quoted: message });
      return;
    }

    await sock.sendMessage(remoteJid, {
      text: [
        "🧠 *Learning*",
        "!learn on/off — owner",
        "!learn status",
        "!learn add <text> — permanent fact for AI",
        "!learn list",
        "!learn forget — clear your entries",
        "",
        "ON thakle normal chat auto save + AI use kore."
      ].join("\n")
    }, { quoted: message });
  }
};
