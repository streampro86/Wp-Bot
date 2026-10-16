export default {
  name: "Ping",
  commands: ["ping"],
  async execute({ sock, remoteJid, config }) {
    const started = Date.now();
    await sock.sendMessage(remoteJid, {
      text: `🏓 ${config.botName}
Pong!
⚡ Response: ${Date.now() - started}ms
✅ Status: Online`
    });
  }
};
