export default {
  name: "Owner",
  commands: ["owner", "owners", "myid"],
  category: "System",
  author: "Mahadi Hasan",
  description: "Show owner status and your detected WhatsApp number",
  async execute({ sock, remoteJid, config, message, isOwner, senderNumber, ownerList, sender }) {
    const botNum = String(sock?.user?.id || "").split(":")[0].split("@")[0].replace(/\D/g, "");
    const list = (ownerList && ownerList.length)
      ? ownerList.map((n) => `• ${n}`).join("\n")
      : "• (empty — set OWNER_NUMBER in environment)";

    const text = [
      `👑 *Owner Check*`,
      ``,
      `Your number: *${senderNumber || "unknown"}*`,
      `Linked bot number: *${botNum || "not connected"}*`,
      `You are owner: *${isOwner ? "YES ✅" : "NO ❌"}*`,
      ``,
      `Configured owners:`,
      list,
      ``,
      isOwner
        ? "✅ Tomar owner access ache."
        : "🔒 Access nai — ei number owner list e nai.\nOWNER_NUMBER env e nijer number set koro."
    ].join("\n");

    await sock.sendMessage(remoteJid, { text }, { quoted: message });
  }
};
