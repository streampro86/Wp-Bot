const pendingMenus = new Map();
const MAX_ENTRIES = 100;
const MENU_TTL_MS = 60_000;

function makeKey(chatId, senderId) { return `${chatId}:${senderId}`; }
function cleanText(text) { return String(text || "").trim().slice(0, 1200); }
async function removeMessage(sock, chatId, key) {
  if (!key) return;
  try { await sock.sendMessage(chatId, { delete: key }); } catch { /* WhatsApp may deny message deletion */ }
}

export async function handleLearningMessage({ body, message, remoteJid, sock, mongoSettingsCollection, mongoDb, addLog }) {
  const senderId = String(message?.key?.participant || message?.key?.remoteJid || "").split(":")[0];
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
        await sock.sendMessage(remoteJid, { text: `🧠 *Learned entry ${choice}*\n${row.text}\n\nBy: ${row.senderId}\nSaved: ${new Date(row.createdAt).toLocaleString()}` });
        return true;
      }
    }
  }

  if (!mongoDb || !body || message?.key?.fromMe || /^(?:!|learn\b|ai\b|font\b)/i.test(body)) return false;
  const settings = await mongoSettingsCollection?.findOne({ _id: "learning" });
  if (settings?.enabled !== true) return false;
  const consent = await mongoDb.collection("learning_consent").findOne({ chatId: remoteJid, senderId });
  if (!consent?.enabled) return false;
  await mongoDb.collection("learning_entries").insertOne({
    chatId: remoteJid,
    senderId,
    text: cleanText(body),
    createdAt: new Date()
  });
  await mongoDb.collection("learning_entries").deleteMany({
    _id: { $in: (await mongoDb.collection("learning_entries").find({ chatId: remoteJid, senderId }).sort({ createdAt: -1 }).skip(MAX_ENTRIES).project({ _id: 1 }).toArray()).map((x) => x._id) }
  });
  addLog?.("debug", `Opt-in learning entry stored for ${senderId}`);
  return false;
}

export const handleMessage = handleLearningMessage;

export default {
  name: "AI Learning & Memory",
  commands: ["learn"],
  aliases: ["learning"],
  category: "AI",
  author: "Mahadi Hasan",
  description: "Consent-based learning, saved entries and reply-number detail view",
  usage: "!learn on/off/status | optin/optout | add <text> | list | forget",
  async execute(ctx) {
    const { sock, remoteJid, args, message, sender, mongoDb, mongoSettingsCollection } = ctx;
    if (!mongoDb || !mongoSettingsCollection) throw new Error("MongoDB is required for learning storage");
    const action = String(args[0] || "help").toLowerCase();
    const senderId = String(sender || remoteJid).split(":")[0];
    const collection = mongoDb.collection("learning_entries");
    const consentCollection = mongoDb.collection("learning_consent");

    if (["on", "off"].includes(action)) {
      if (!ctx.isOwner) {
        await sock.sendMessage(remoteJid, { text: "🔒 Global learning ON/OFF শুধু bot owner করতে পারবে." }, { quoted: message });
        return;
      }
      await mongoSettingsCollection.updateOne({ _id: "learning" }, { $set: { enabled: action === "on", updatedAt: new Date() } }, { upsert: true });
      await sock.sendMessage(remoteJid, { text: `🧠 Learning ${action.toUpperCase()} হয়েছে। প্রত্যেক user-কে opt-in করতে হবে: !learn optin` }, { quoted: message });
      return;
    }
    if (action === "status") {
      const state = await mongoSettingsCollection.findOne({ _id: "learning" });
      const consent = await consentCollection.findOne({ chatId: remoteJid, senderId });
      await sock.sendMessage(remoteJid, { text: `🧠 Learning: ${state?.enabled ? "ON" : "OFF"}\nYour opt-in: ${consent?.enabled ? "ON" : "OFF"}\nEntries: ${await collection.countDocuments({ chatId: remoteJid, senderId })}` }, { quoted: message });
      return;
    }
    if (action === "optin" || action === "optout") {
      await consentCollection.updateOne({ chatId: remoteJid, senderId }, { $set: { enabled: action === "optin", updatedAt: new Date() } }, { upsert: true });
      if (action === "optout") await collection.deleteMany({ chatId: remoteJid, senderId });
      await sock.sendMessage(remoteJid, { text: action === "optin" ? "✅ তুমি opt-in করেছ। Learning ON থাকলে তোমার পরের সাধারণ messages সংরক্ষণ হবে। বন্ধ করতে !learn optout দাও।" : "🧹 Opt-out সম্পন্ন; তোমার saved learning entries মুছে দেওয়া হয়েছে।" }, { quoted: message });
      return;
    }
    if (action === "add") {
      const text = cleanText(args.slice(1).join(" "));
      if (!text) { await sock.sendMessage(remoteJid, { text: "Usage: !learn add <তথ্য>" }, { quoted: message }); return; }
      await collection.insertOne({ chatId: remoteJid, senderId, text, createdAt: new Date(), source: "explicit" });
      await sock.sendMessage(remoteJid, { text: "✅ এই তথ্য learning memory-তে save হয়েছে।" }, { quoted: message });
      return;
    }
    if (action === "forget") {
      await collection.deleteMany({ chatId: remoteJid, senderId });
      await sock.sendMessage(remoteJid, { text: "🧹 তোমার saved learning entries মুছে দেওয়া হয়েছে।" }, { quoted: message });
      return;
    }
    if (action === "list") {
      const entries = await collection.find({ chatId: remoteJid, senderId }).sort({ createdAt: -1 }).limit(10).toArray();
      if (!entries.length) { await sock.sendMessage(remoteJid, { text: "📭 কোনো saved learning entry নেই। !learn add <text> ব্যবহার করো।" }, { quoted: message }); return; }
      const menu = ["🧠 *Learning entries*", ...entries.map((entry, index) => `${index + 1}. ${entry.text.slice(0, 90)}`), "", "কোনো নম্বরে Reply দিলে full details দেখাবে (60 sec)."].join("\n");
      const sent = await sock.sendMessage(remoteJid, { text: menu }, { quoted: message });
      pendingMenus.set(makeKey(remoteJid, senderId), { menuKey: sent?.key, entries, expiresAt: Date.now() + MENU_TTL_MS });
      return;
    }
    await sock.sendMessage(remoteJid, { text: [
      "🧠 *Mahadi Hasan — Learning*",
      "!learn on/off — owner-only global learning control",
      "!learn optin/optout — your own consent",
      "!learn status — current status",
      "!learn add <text> — save a note explicitly",
      "!learn list — numbered list; reply with a number for details",
      "!learn forget — delete your saved entries"
    ].join("\n") }, { quoted: message });
  }
};
