import { applySavedFont } from "../src/utils/font.js";

export default {
  name: "Ping",
  commands: ["ping"],
  async execute({ sock, remoteJid, config, mongoSettingsCollection, message, addLog }) {
    const started = Date.now();
    const raw = `🏓 *${config.botName}*\nPong!\n⚡ Response: ${Date.now() - started}ms\n✅ Status: Online`;
    const text = await applySavedFont(raw, mongoSettingsCollection);
    await sock.sendMessage(remoteJid, { text }, { quoted: message });
    addLog?.("send", "Ping reply sent");
  }
};
