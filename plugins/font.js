import { fancyText } from "../src/utils/font.js";

const pendingMenus = new Map();
const STYLES = [
  { number: "1", key: "normal", label: "Normal" },
  { number: "2", key: "fancy", label: "Fancy Script" },
  { number: "3", key: "bold", label: "Bold" },
  { number: "4", key: "mono", label: "Monospace" }
];
const MENU_TTL_MS = 60_000;

function pendingKey(remoteJid, sender) {
  return `${remoteJid}:${String(sender || "unknown")}`;
}

async function deleteBotMessage(sock, remoteJid, key) {
  if (!key) return;
  try { await sock.sendMessage(remoteJid, { delete: key }); } catch { /* deletion can be disallowed in some chats */ }
}

export async function handleMessage({ body, message, remoteJid, sock, mongoSettingsCollection, addLog }) {
  const sender = message?.key?.participant || message?.key?.remoteJid || "unknown";
  const key = pendingKey(remoteJid, sender);
  const pending = pendingMenus.get(key);
  if (!pending) return false;

  if (Date.now() > pending.expiresAt) {
    pendingMenus.delete(key);
    await deleteBotMessage(sock, remoteJid, pending.menuKey);
    return false;
  }

  // Only consume a short numeric reply while the menu is active.
  const choice = String(body || "").trim();
  const selected = STYLES.find((style) => style.number === choice);
  if (!selected) return false;
  const quotedId = message?.message?.extendedTextMessage?.contextInfo?.stanzaId;
  if (pending.menuKey?.id && quotedId !== pending.menuKey.id) return false;

  if (!mongoSettingsCollection) {
    pendingMenus.delete(key);
    await deleteBotMessage(sock, remoteJid, pending.menuKey);
    await sock.sendMessage(remoteJid, { text: "⚠️ MongoDB সংযুক্ত নেই—font setting save করা যায়নি।" });
    return true;
  }

  await mongoSettingsCollection.updateOne(
    { _id: "font" },
    { $set: { style: selected.key, updatedAt: new Date(), updatedBy: String(sender) } },
    { upsert: true }
  );
  pendingMenus.delete(key);
  await deleteBotMessage(sock, remoteJid, pending.menuKey);
  // Delete the selection reply when WhatsApp permissions allow it (usually requires group-admin rights).
  await deleteBotMessage(sock, remoteJid, message?.key);
  await sock.sendMessage(remoteJid, {
    text: `✅ Font style সেট হয়েছে: ${selected.label}\n🔤 Example: ${fancyText("Mahadi Hasan", selected.key)}`
  });
  addLog?.("success", `Font style selected: ${selected.key}`);
  return true;
}

export default {
  name: "Font Changer",
  commands: ["font"],
  category: "Utility",
  author: "Mahadi Hasan",
  aliases: ["fonts", "fontstyle"],
  description: "Reply with a number to select a saved font style or convert text",
  usage: "!font | reply 1-4 | !font fancy Your text",
  permission: "all",
  async execute({ sock, remoteJid, args, mongoSettingsCollection, message, sender }) {
    const style = (args[0] || "").toLowerCase();
    const available = STYLES.map((item) => item.key);

    if (!style) {
      const current = await mongoSettingsCollection?.findOne({ _id: "font" });
      const menu = [
        "🔤 *Mahadi Hasan — Font Menu*",
        `Current style: ${current?.style || "normal"}`,
        "",
        ...STYLES.map((item) => `${item.number}. ${item.label}`),
        "",
        "উপরের মেসেজে 1–4 লিখে Reply দাও।",
        "নির্বাচনের পর এই menu message মুছে যাবে। (সময়: 60 সেকেন্ড)"
      ].join("\n");
      const sent = await sock.sendMessage(remoteJid, { text: menu }, { quoted: message });
      const who = sender || message?.key?.participant || message?.key?.remoteJid || "unknown";
      pendingMenus.set(pendingKey(remoteJid, who), {
        menuKey: sent?.key,
        expiresAt: Date.now() + MENU_TTL_MS
      });
      return;
    }

    if (available.includes(style) && args.length === 1) {
      if (!mongoSettingsCollection) throw new Error("MongoDB is not connected");
      await mongoSettingsCollection.updateOne(
        { _id: "font" },
        { $set: { style, updatedAt: new Date(), updatedBy: String(sender || "unknown") } },
        { upsert: true }
      );
      await sock.sendMessage(remoteJid, { text: `✅ Font style saved: ${style}` }, { quoted: message });
      return;
    }

    const convertStyle = available.includes(style) ? style : "fancy";
    const text = available.includes(style) ? args.slice(1).join(" ") : args.join(" ");
    if (!text.trim()) {
      await sock.sendMessage(remoteJid, { text: "Usage: !font fancy Your text" }, { quoted: message });
      return;
    }
    await sock.sendMessage(remoteJid, { text: fancyText(text, convertStyle) }, { quoted: message });
  }
};
