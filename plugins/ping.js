export default {
  name: "Ping",
  commands: ["ping"],
  async execute({ sock, remoteJid, config }) {
    const started = Date.now();
    await sock.sendMessage(remoteJid, {
      text: `🏓 *${config.botName}*\nPong!\n⚡ Response: ${Date.now() - started}ms\n✅ Status: Online`
    });
  }
};
