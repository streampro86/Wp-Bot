const MEMORY_LIMIT = 14;
const DEFAULTS = Object.freeze({
  autoChat: false,
  group: true,
  inbox: true,
  memory: true
});

function senderNumber(sender = "") {
  return String(sender).split("@")[0].split(":")[0].replace(/\D/g, "");
}

export async function readAISettings(collection) {
  if (!collection) return { ...DEFAULTS };
  const doc = await collection.findOne({ _id: "ai" });
  return { ...DEFAULTS, ...(doc?.values || {}) };
}

export async function saveAISettings(collection, values) {
  if (!collection) throw new Error("MongoDB settings are not available");
  await collection.updateOne(
    { _id: "ai" },
    { $set: { values: { ...DEFAULTS, ...values }, updatedAt: new Date() } },
    { upsert: true }
  );
}

const MAHADI_SYSTEM = `
তুমি Mahadi Hasan। ভদ্র বাংলাদেশি মানুষ। সবসময় "আপনি" বলো।

সবচেয়ে গুরুত্বপূর্ণ নিয়ম:
1) User-এর সর্বশেষ message-এর সরাসরি উত্তর দাও। অন্য কিছু নিয়ে ঘোরাঘুরি কোরো না।
2) একই উত্তর কখনো দুইবার দিও না। "ওয়ালাইকুম সালাম / আপনি কেমন আছেন" বারবার বলা সম্পূর্ণ নিষেধ।
3) আগের কথোপকথন থাকলে সেখান থেকে এগোও — আবার salam বা "কেমন আছেন" জিজ্ঞেস কোরো না যদি আগে বলে থাকো।
4) ছোট reply (১ বাক্য বা ২ ছোট লাইন)। Robot ভাষা নয়।

সালাম নিয়ম:
- User সালাম দিলে শুধু: "ওয়ালাইকুম সালাম" + ছোট follow-up (প্রয়োজন হলে)।
- User শুধু "Hi/Hello/হ্যালো" বললে সংক্ষেপে greeting — প্রতিবার একই sentence নয়।
- User অন্য কিছু বললে (যেমন "Bal", কোনো প্রশ্ন, মন্তব্য) সালাম দিও না; সরাসরি সেই বিষয়ে উত্তর দাও।

অন্যান্য:
- নাম প্রিফিক্স ("Mahadi Hasan:") লিখবে না।
- AI/bot পরিচয় দিও না যতক্ষণ না জিজ্ঞেস করে।
- Emoji ০–১টা optional।
`.trim();

function extractAnswer(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.text, data.reply, data.response, data.message, data.result,
    data.answer, data.output, data.content,
    data.data?.text, data.data?.reply, data.data?.response, data.data?.message,
    data.choices?.[0]?.message?.content, data.choices?.[0]?.text
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function cleanReply(text) {
  let t = String(text || "").trim();
  t = t.replace(/^(Mahadi Hasan|Mahadi|Hasan|Bot|AI|Assistant)\s*[:\-–—]\s*/i, "");
  t = t.replace(/\b(Hasu Bot|HASU BOT|Hasu|Ritu|Sadiya)\b/gi, "Mahadi Hasan");
  // Soft enforce apni: if model still uses tui forms in short replies, leave as-is (prompt handles it)
  return t.replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
}

async function setTyping(sock, remoteJid, on = true) {
  try {
    await sock.sendPresenceUpdate(on ? "composing" : "paused", remoteJid);
  } catch { /* ignore */ }
}

async function askAI(prompt, config, addLog) {
  const base = config?.ai?.endpoint || "https://hasan-indol.vercel.app/api/chat";
  const endpoint = new URL(base);
  endpoint.searchParams.set("message", String(prompt).slice(0, 3500));
  endpoint.searchParams.set("provider", config?.ai?.provider || "auto");

  const controller = new AbortController();
  const timeoutMs = config?.ai?.timeoutMs || 25000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  addLog?.("info", `AI request → ${endpoint.origin}${endpoint.pathname}`);

  try {
    const response = await fetch(endpoint.toString(), {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "MahadiHasanBot/2.4" }
    });
    const rawText = await response.text();
    let data = {};
    try { data = JSON.parse(rawText); } catch { data = { text: rawText }; }

    if (!response.ok) {
      const errDetail = (data.error || data.message || rawText || "").toString().slice(0, 200);
      addLog?.("error", `AI API HTTP ${response.status}: ${errDetail}`);
      throw new Error(`AI API HTTP ${response.status}: ${errDetail || "no body"}`);
    }
    const answer = extractAnswer(data);
    if (!answer) {
      addLog?.("error", `AI API ok but no reply. Keys: ${Object.keys(data).join(",")}`);
      throw new Error("AI API response did not contain a reply");
    }
    addLog?.("success", `AI reply ok (${answer.length} chars)`);
    return cleanReply(answer);
  } catch (err) {
    if (err?.name === "AbortError") {
      addLog?.("error", `AI timeout after ${timeoutMs}ms`);
      throw new Error(`AI timeout after ${timeoutMs}ms`);
    }
    addLog?.("error", `AI request failed: ${err.message}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function getConversationContext(mongoDb, chatId, senderId) {
  if (!mongoDb) return [];
  const rows = await mongoDb.collection("ai_memory")
    .find({ chatId, senderId })
    .sort({ createdAt: -1 })
    .limit(MEMORY_LIMIT)
    .toArray();
  return rows.reverse();
}

async function getLearningNotes(mongoDb, chatId, senderId) {
  if (!mongoDb || !senderId) return [];
  try {
    const digits = String(senderId).replace(/\D/g, "");
    const rows = await mongoDb.collection("learning_entries")
      .find({
        chatId,
        $or: [
          { senderId },
          { senderId: digits },
          { senderId: { $regex: digits.slice(-10) } }
        ]
      })
      .sort({ createdAt: -1 })
      .limit(8)
      .toArray();
    return rows.map((r) => String(r.text || "").trim().slice(0, 300)).filter(Boolean);
  } catch {
    return [];
  }
}

async function replyWithMemory({ prompt, config, mongoDb, chatId, senderId, memoryEnabled, addLog }) {
  let extra = "";
  if (memoryEnabled && mongoDb && chatId && senderId) {
    const history = await getConversationContext(mongoDb, chatId, senderId);
    if (history.length) {
      const transcript = history
        .map((item) => `${item.role === "assistant" ? "Mahadi" : "User"}: ${item.text}`)
        .join("\n");
      extra += `\n\nআগের কথোপকথন (repeat কোরো না):\n${transcript}`;
    }
    const notes = await getLearningNotes(mongoDb, chatId, senderId);
    if (notes.length) {
      extra += `\n\nSaved notes (use if relevant):\n- ${notes.join("\n- ")}`;
    }
  }

  let ban = "";
  if (memoryEnabled && mongoDb && chatId && senderId) {
    try {
      const last = await mongoDb.collection("ai_memory")
        .find({ chatId, senderId, role: "assistant" })
        .sort({ createdAt: -1 })
        .limit(2)
        .toArray();
      if (last.length) {
        ban = "\n\nতোমার আগের উত্তর (এর মতো বা কাছাকাছি লিখবে না):\n" + last.map((x) => `- ${String(x.text).slice(0, 120)}`).join("\n");
      }
    } catch {}
  }

  const requestPrompt = `${MAHADI_SYSTEM}${extra}${ban}\n\nUser-এর নতুন message: ${prompt}\n\nশুধু এই message-এর relevant উত্তর দাও। আগের উত্তর repeat নিষেধ। নাম প্রিফিক্স ছাড়া, আপনি বলে:`;
  let answer = await askAI(requestPrompt, config, addLog);

  // If model still repeated last reply, one forced retry
  if (ban && answer) {
    const prevLines = ban.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim().toLowerCase());
    const norm = answer.toLowerCase().replace(/\s+/g, " ").trim();
    const repeated = prevLines.some((p) => p && (norm.includes(p.slice(0, 40)) || p.includes(norm.slice(0, 40))));
    if (repeated) {
      addLog?.("warn", "AI repeated previous reply — retrying once");
      answer = await askAI(
        `${MAHADI_SYSTEM}\n\nUser: ${prompt}\n\nআগের উত্তরগুলো ban। একদম নতুন করে, সালাম ছাড়া, শুধু এই message-এর উত্তর (আপনি বলে):`,
        config,
        addLog
      );
    }
  }

  if (memoryEnabled && mongoDb && chatId && senderId) {
    try {
      const collection = mongoDb.collection("ai_memory");
      await collection.insertMany([
        { chatId, senderId, role: "user", text: prompt.slice(0, 2000), createdAt: new Date() },
        { chatId, senderId, role: "assistant", text: answer.slice(0, 4000), createdAt: new Date() }
      ]);
      const count = await collection.countDocuments({ chatId, senderId });
      if (count > MEMORY_LIMIT * 2) {
        const old = await collection.find({ chatId, senderId }).sort({ createdAt: 1 }).limit(count - MEMORY_LIMIT * 2).project({ _id: 1 }).toArray();
        if (old.length) await collection.deleteMany({ _id: { $in: old.map((item) => item._id) } });
      }
    } catch (e) {
      addLog?.("warn", `AI memory save failed: ${e.message}`);
    }
  }
  return answer;
}

export async function handleAutoAI(context) {
  const { body, remoteJid, sock, config, mongoSettingsCollection, mongoDb, message, sender, commandHandled, addLog, applySavedFont } = context;
  if (commandHandled) return false;
  if (message?.key?.fromMe) {
    addLog?.("debug", "Auto AI skip: message from linked bot number (test from another phone)");
    return false;
  }
  if (!body) return false;
  if (/^(?:!|ai\s|font\s|learn\b|ping\b|status\b|alive\b|help\b|menu\b|commands\b|owner\b|myid\b)/i.test(body)) return false;

  const settings = await readAISettings(mongoSettingsCollection);
  if (!settings.autoChat) {
    addLog?.("debug", "Auto AI skip: autoChat is OFF (use !ai on)");
    return false;
  }
  if (remoteJid.endsWith("@g.us") && !settings.group) {
    addLog?.("warn", "Auto AI skip: group replies OFF (use !ai group on)");
    return false;
  }
  if (remoteJid.endsWith("@s.whatsapp.net") && !settings.inbox) {
    addLog?.("warn", "Auto AI skip: inbox replies OFF (use !ai inbox on)");
    return false;
  }

  try {
    addLog?.("info", "Auto AI generating reply…");
    await setTyping(sock, remoteJid, true);
    const answer = await replyWithMemory({
      prompt: body,
      config,
      mongoDb,
      chatId: remoteJid,
      senderId: senderNumber(sender || message?.key?.participant || remoteJid),
      memoryEnabled: settings.memory,
      addLog
    });
    let text = answer;
    if (typeof applySavedFont === "function") {
      try { text = await applySavedFont(answer, mongoSettingsCollection); } catch {}
    }
    await setTyping(sock, remoteJid, false);
    await sock.sendMessage(remoteJid, { text }, { quoted: message });
    addLog?.("send", `Auto AI reply sent (${text.length} chars)`);
    return true;
  } catch (err) {
    await setTyping(sock, remoteJid, false);
    addLog?.("error", `Auto AI failed: ${err.message}`);
    return false;
  }
}

export default {
  name: "AI Chat",
  commands: ["ai"],
  aliases: ["chatgpt", "chat"],
  category: "AI",
  author: "Mahadi Hasan",
  description: "Mahadi Hasan AI — respectful apni-style natural chat",
  usage: "!ai <message> | !ai on/off/status | !ai group on/off | !ai inbox on/off | !ai memory on/off | !ai forget",
  async execute(ctx) {
    const { sock, remoteJid, args, config, mongoSettingsCollection, mongoDb, message, sender, addLog } = ctx;
    const action = (args[0] || "").toLowerCase();
    const settings = await readAISettings(mongoSettingsCollection);
    const needsOwner = ["on", "off", "status", "group", "inbox", "memory", "forget"].includes(action);

    if (needsOwner && !ctx.isOwner && !ctx.isAdmin) {
      await sock.sendMessage(remoteJid, {
        text: "🔒 Access nai.\nEi command shudhu *Owner* ba group admin use korte parbe."
      }, { quoted: message });
      return;
    }

    if (action === "status") {
      await sock.sendMessage(remoteJid, {
        text: [
          "🤖 *Mahadi Hasan AI Status*",
          `Auto Chat: ${settings.autoChat ? "ON ✅" : "OFF"}`,
          `Group: ${settings.group ? "ON ✅" : "OFF"}`,
          `Inbox: ${settings.inbox ? "ON ✅" : "OFF"}`,
          `Memory: ${settings.memory ? "ON ✅" : "OFF"}`
        ].join("\n")
      }, { quoted: message });
      return;
    }

    if (["on", "off"].includes(action)) {
      settings.autoChat = action === "on";
      await saveAISettings(mongoSettingsCollection, settings);
      await sock.sendMessage(remoteJid, {
        text: `✅ AI Auto Chat *${action.toUpperCase()}* — save hoyeche.`
      }, { quoted: message });
      return;
    }

    if (["group", "inbox", "memory"].includes(action)) {
      const value = String(args[1] || "").toLowerCase();
      if (!["on", "off"].includes(value)) {
        await sock.sendMessage(remoteJid, { text: `Usage: !ai ${action} on/off` }, { quoted: message });
        return;
      }
      settings[action] = value === "on";
      await saveAISettings(mongoSettingsCollection, settings);
      await sock.sendMessage(remoteJid, {
        text: `✅ AI *${action}* *${value.toUpperCase()}* — saved.`
      }, { quoted: message });
      return;
    }

    if (action === "forget") {
      const sid = senderNumber(sender || remoteJid);
      if (!mongoDb) throw new Error("MongoDB is not connected");
      await mongoDb.collection("ai_memory").deleteMany({ chatId: remoteJid, senderId: sid });
      await sock.sendMessage(remoteJid, { text: "🧹 Ei chat er AI memory clear hoye geche." }, { quoted: message });
      return;
    }

    const prompt = args.join(" ").trim();
    if (!prompt) {
      await sock.sendMessage(remoteJid, {
        text: [
          "🤖 *Mahadi Hasan AI*",
          "",
          "!ai <message>",
          "!ai on/off",
          "!ai status",
          "!ai group/inbox/memory on/off",
          "!ai forget"
        ].join("\n")
      }, { quoted: message });
      return;
    }

    try {
      await setTyping(sock, remoteJid, true);
      const answer = await replyWithMemory({
        prompt,
        config,
        mongoDb,
        chatId: remoteJid,
        senderId: senderNumber(sender || remoteJid),
        memoryEnabled: settings.memory,
        addLog
      });
      let text = answer;
      try {
        const { applySavedFont } = await import("../src/utils/font.js");
        text = await applySavedFont(answer, mongoSettingsCollection);
      } catch {}
      await setTyping(sock, remoteJid, false);
      await sock.sendMessage(remoteJid, { text }, { quoted: message });
      addLog?.("send", `AI reply sent (${text.length} chars)`);
    } catch (err) {
      await setTyping(sock, remoteJid, false);
      addLog?.("error", `!ai failed: ${err.message}`);
      await sock.sendMessage(remoteJid, { text: `⚠️ AI fail: ${err.message}` }, { quoted: message });
    }
  }
};
