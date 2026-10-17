import { applySavedFont } from "../src/utils/font.js";
export default {
  name: "Help",
  commands: ["help", "menu", "commands"],
  category: "System",
  author: "Mahadi Hasan",
  description: "Show all available commands and bot info",
  async execute(ctx) {
    const { sock, remoteJid, config, message, mongoSettingsCollection } = ctx;
    const prefix = config.prefix || "!";
    const bot = config.botName || "Mahadi Hasan";

    const text = [
      `╭─── ✦ *${bot}* ✦ ───╮`,
      `│`,
      `│  👋 Welcome!`,
      `│  Author: *Mahadi Hasan*`,
      `│  Prefix: \`${prefix}\`  (no-prefix also works)`,
      `│`,
      `├── 📌 *Basic*`,
      `│  ${prefix}ping`,
      `│  ${prefix}status  /  ${prefix}alive`,
      `│  ${prefix}help   /  ${prefix}menu`,
      `│  ${prefix}owner  /  ${prefix}myid`,
      `│`,
      `├── 🤖 *AI*`,
      `│  ${prefix}ai <message>`,
      `│  ${prefix}ai on / off`,
      `│  ${prefix}ai status`,
      `│  ${prefix}ai group on/off`,
      `│  ${prefix}ai inbox on/off`,
      `│  ${prefix}ai memory on/off`,
      `│  ${prefix}ai forget`,
      `│`,
      `├── 🎨 *Font*`,
      `│  ${prefix}font`,
      `│`,
      `├── 🧠 *Learn*`,
      `│  ${prefix}learn`,
      `│`,
      `├── ℹ️ *Notes*`,
      `│  • Commands work in group & private`,
      `│  • Owner settings need owner number`,
      `│  • Auto AI is OFF by default`,
      `│`,
      `╰─── Powered by *Mahadi Hasan* ───╯`
    ].join("\n");

    const styled = await applySavedFont(text, mongoSettingsCollection);
    await sock.sendMessage(remoteJid, { text: styled }, { quoted: message });
  }
};
