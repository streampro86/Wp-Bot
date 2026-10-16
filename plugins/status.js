export default {
  name: "Status",
  commands: ["status", "alive"],
  async execute({ sock, remoteJid, config }) {
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    await sock.sendMessage(remoteJid, {
      text: `✅ ${config.botName} is online

⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s
🧩 Plugins: Ping + Status
👨‍💻 Author: ${config.author}`
    });
  }
};
