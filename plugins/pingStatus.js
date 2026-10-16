export default {
  name: "Ping & Status",
  commands: ["ping", "status", "alive"],
  async execute({ sock, remoteJid, config, command }) {
    const started = Date.now();
    if (command === "ping") {
      await sock.sendMessage(remoteJid, {
        text: `🏓 ${config.botName}\nPong!\nResponse: ${Date.now() - started}ms\nStatus: Online`
      });
      return;
    }
    if (command === "alive" || command === "status") {
      const uptime = Math.floor(process.uptime());
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;
      await sock.sendMessage(remoteJid, {
        text: `✅ ${config.botName} is online\n\n⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s\n🧩 Plugin: Ping & Status\n👨‍💻 Author: ${config.author}`
      });
    }
  }
};
