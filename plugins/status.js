import { applySavedFont } from "../src/utils/font.js";

export default {
  name: "Status",
  commands: ["status", "alive"],
  category: "System",
  author: "Mahadi Hasan",
  description: "Bot connectivity and runtime status",
  async execute({ sock, remoteJid, config, mongoSettingsCollection, message, addLog }) {
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    const pluginNames = Object.entries(config.plugins || {})
      .filter(([, enabled]) => enabled !== false)
      .map(([name]) => name);
    const raw = [
      `✅ *${config.botName}* is online`,
      "",
      `⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s`,
      `🧩 Enabled plugins: ${pluginNames.join(", ") || "none"}`,
      `👨‍💻 Author: ${config.author}`
    ].join("\n");
    const text = await applySavedFont(raw, mongoSettingsCollection);
    await sock.sendMessage(remoteJid, { text }, { quoted: message });
    addLog?.("send", "Status reply sent");
  }
};
