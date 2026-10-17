import { applySavedFont } from "../src/utils/font.js";

export default {
  name: "Help",
  commands: ["help", "menu", "commands"],
  category: "System",
  author: "Mahadi Hasan",
  description: "Show available commands",
  async execute(ctx) {
    const { sock, remoteJid, config, message, mongoSettingsCollection, isOwner } = ctx;
    const prefix = config.prefix || "!";
    const bot = config.botName || "Mahadi Hasan";

    const lines = [
      `╭─── ✦ *${bot}* ✦ ───╮`,
      `│`,
      `│  Assalamu Alaikum`,
      `│  Author: *Mahadi Hasan*`,
      `│  Prefix: \`${prefix}\``,
      `│`,
      `├── 📌 *Basic*`,
      `│  ${prefix}ping`,
      `│  ${prefix}status / ${prefix}alive`,
      `│  ${prefix}help / ${prefix}menu`,
      `│  ${prefix}myid`,
      `│`,
      `├── 🤖 *AI*`,
      `│  ${prefix}ai <message>`,
    ];

    if (isOwner) {
      lines.push(
        `│  ${prefix}ai on/off/status`,
        `│  ${prefix}ai group/inbox/memory on/off`,
        `│  ${prefix}ai forget`,
        `│  ${prefix}owner`
      );
    }

    lines.push(
      `│`,
      `├── 🎨 *Font*`,
      `│  ${prefix}font`,
      `│`,
      `├── 🧠 *Learn*`,
      `│  ${prefix}learn status`,
      `│  ${prefix}learn optin / optout`,
      `│  ${prefix}learn add <text>`,
      `│  ${prefix}learn list`,
    );

    if (isOwner) {
      lines.push(`│  ${prefix}learn on/off  (owner)`);
    }

    lines.push(
      `│`,
      `╰─── *Mahadi Hasan* ───╯`
    );

    const text = lines.join("\n");
    const styled = await applySavedFont(text, mongoSettingsCollection);
    await sock.sendMessage(remoteJid, { text: styled }, { quoted: message });
  }
};
