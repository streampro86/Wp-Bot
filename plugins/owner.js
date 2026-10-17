export default {
  name: "Owner",
  commands: ["owner", "owners", "myid"],
  category: "System",
  author: "Mahadi Hasan",
  description: "Owner-only identity check",
  async execute({ sock, remoteJid, message, isOwner, senderNumber, ownerList }) {
    // Regular users: only show their own number, no owner database
    if (!isOwner) {
      await sock.sendMessage(remoteJid, {
        text: [
          "🆔 *Your ID*",
          `Number: *${senderNumber || "unknown"}*`,
          "",
          "Owner panel shudhu owner dekhte parbe."
        ].join("\n")
      }, { quoted: message });
      return;
    }

    const botNum = String(sock?.user?.id || "").split(":")[0].split("@")[0].replace(/\D/g, "");
    const list = (ownerList && ownerList.length)
      ? ownerList.map((n) => `• ${n}`).join("\n")
      : "• (empty)";

    await sock.sendMessage(remoteJid, {
      text: [
        "👑 *Owner Panel*",
        `Your number: *${senderNumber}*`,
        `Linked bot: *${botNum || "n/a"}*`,
        `Status: *Owner ✅*`,
        "",
        "Configured owners:",
        list
      ].join("\n")
    }, { quoted: message });
  }
};
