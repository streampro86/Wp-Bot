export default {
  name: "Status",
  commands: ["status", "alive"],
  category: "System",
  author: "Mahadi Hasan",
  description: "Bot connectivity and runtime status",
  async execute({ sock, remoteJid, config }) {
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    const pluginNames = Object.entries(config.plugins || {}).filter(([, enabled]) => enabled !== false).map(([name]) => name);
    await sock.sendMessage(remoteJid, {
      text: `✅ ${config.botName} is online\n\n⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s\n🧩 Enabled plugins: ${pluginNames.join(", ") || "none"}\n👨‍💻 Author: ${config.author}`
    });
  }
};
