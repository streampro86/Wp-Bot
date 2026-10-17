import { fancyText } from "../src/utils/font.js";
export default {
  name: "Font Changer", commands: ["font"], category: "Utility", author: "Mahadi Hasan",
  description: "Set a persistent fancy font style or convert text",
  async execute({ sock, remoteJid, args, mongoSettingsCollection, message }) {
    const style = (args[0] || "").toLowerCase();
    const available = ["normal","fancy","bold","mono"];
    if (!style) { const d=await mongoSettingsCollection?.findOne({_id:"font"}); await sock.sendMessage(remoteJid,{text:`🔤 Mahadi Hasan Font Changer\nCurrent style: ${d?.style || "normal"}\nUsage: !font normal/fancy/bold/mono\nConvert: !font fancy Your text`}); return; }
    if (available.includes(style) && args.length === 1) {
      if (!mongoSettingsCollection) throw new Error("MongoDB is not connected");
      await mongoSettingsCollection.updateOne({_id:"font"},{$set:{style,updatedAt:new Date()}},{upsert:true});
      await sock.sendMessage(remoteJid,{text:`✅ Font style saved in MongoDB: ${style}`}); return;
    }
    const convertStyle = available.includes(style) ? style : "fancy";
    const text = available.includes(style) ? args.slice(1).join(" ") : args.join(" ");
    await sock.sendMessage(remoteJid,{text:fancyText(text,convertStyle)},{quoted:message});
  }
};
