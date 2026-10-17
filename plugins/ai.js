import { fancyText } from "../src/utils/font.js";

async function readSettings(db) {
  if (!db) return {};
  const doc = await db.findOne({ _id: "ai" });
  return doc?.values || {};
}
async function saveSettings(db, values) {
  if (!db) throw new Error("MongoDB settings are not available");
  await db.updateOne({ _id: "ai" }, { $set: { values, updatedAt: new Date() } }, { upsert: true });
}
async function askAI(prompt, config) {
  const endpoint = new URL(config.ai.endpoint); endpoint.searchParams.set("message", prompt); endpoint.searchParams.set("provider", config.ai.provider || "auto");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs || 20000);
  try {
    const response = await fetch(endpoint, { signal: controller.signal, headers: { accept: "application/json" } });
    const data = await response.json(); if (!response.ok) throw new Error(`AI API HTTP ${response.status}`);
    const answer = data.reply || data.response || data.message || data.result || data.data?.reply || data.data?.response || data.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) throw new Error("AI API response did not contain a recognized reply field");
    return answer.trim();
  } finally { clearTimeout(timer); }
}
export async function handleAutoAI({ body, remoteJid, sock, config, mongoSettingsCollection, message, commandHandled }) {
  if (commandHandled || message?.key?.fromMe || !body || /^(?:!|ai\s|font\s|ping\b|status\b|alive\b)/i.test(body)) return false;
  const settings = await readSettings(mongoSettingsCollection);
  if (settings.autoChat !== true) return false;
  if (remoteJid.endsWith("@g.us") && settings.group !== true) return false;
  if (remoteJid.endsWith("@s.whatsapp.net") && settings.inbox === false) return false;
  const reply = await askAI(body, config);
  await sock.sendMessage(remoteJid, { text: reply }, { quoted: message });
  return true;
}
export default {
  name: "AI", commands: ["ai"], category: "AI", author: "Mahadi Hasan",
  description: "AI chat and automatic replies; settings persist in MongoDB",
  async execute(ctx) {
    const { sock, remoteJid, args, config, mongoSettingsCollection, message } = ctx;
    const action = (args[0] || "").toLowerCase();
    const settings = await readSettings(mongoSettingsCollection);
    if (["on","off","status","group","inbox"].includes(action)) {
      if (!ctx.isOwner && !ctx.isAdmin) { await sock.sendMessage(remoteJid,{text:"🔒 এই সেটিং পরিবর্তন করার অনুমতি নেই।"}); return; }
      if (action === "status") { await sock.sendMessage(remoteJid,{text:`🤖 Mahadi Hasan AI\nAuto Chat: ${settings.autoChat ? "ON" : "OFF"}\nGroup: ${settings.group ? "ON" : "OFF"}\nInbox: ${settings.inbox === false ? "OFF" : "ON"}`}); return; }
      if (action === "on" || action === "off") settings.autoChat = action === "on";
      else if (args[1] && ["on","off"].includes(args[1].toLowerCase())) settings[action] = args[1].toLowerCase() === "on";
      else { await sock.sendMessage(remoteJid,{text:"Usage: !ai on/off/status | !ai group on/off | !ai inbox on/off"}); return; }
      await saveSettings(mongoSettingsCollection, settings);
      await sock.sendMessage(remoteJid,{text:`✅ Mahadi Hasan AI ${action === "on" || action === "off" ? `Auto Chat ${action.toUpperCase()}` : `${action} ${settings[action] ? "ON" : "OFF"}`} saved to MongoDB.`}); return;
    }
    const prompt = args.join(" ").trim();
    if (!prompt) { await sock.sendMessage(remoteJid,{text:"🤖 Mahadi Hasan AI\nCommands: !ai <message>, !ai on, !ai off, !ai status, !ai group on/off, !ai inbox on/off\nAuto Chat default: OFF"}); return; }
    const answer = await askAI(prompt, config);
    await sock.sendMessage(remoteJid,{text:answer},{quoted:message});
  }
};
