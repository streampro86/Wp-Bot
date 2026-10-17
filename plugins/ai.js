const MEMORY_LIMIT = 10;
const DEFAULTS = Object.freeze({ autoChat: false, group: false, inbox: true, memory: true });

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

async function askAI(prompt, config) {
  const endpoint = new URL(config.ai.endpoint);
  endpoint.searchParams.set("message", prompt);
  endpoint.searchParams.set("provider", config.ai.provider || "auto");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs || 20000);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`AI API returned HTTP ${response.status}`);
    const answer = data.reply || data.response || data.message || data.result
      || data.data?.reply || data.data?.response || data.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) throw new Error("AI API response did not contain a reply");
    return answer.trim().slice(0, 6000);
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

async function replyWithMemory({ prompt, config, mongoDb, chatId, senderId, memoryEnabled }) {
  let requestPrompt = `You are Mahadi Hasan Bot’s chat assistant. Reply naturally and warmly in the language the user uses, usually Bangla or Bangla-English. Keep ordinary replies concise unless asked for detail. Use relevant conversation context, do not invent personal facts, and do not claim to be a real human.\n\nUser message: ${prompt}`;
  let history = [];
  if (memoryEnabled && mongoDb && chatId && senderId) {
    history = await getConversationContext(mongoDb, chatId, senderId);
    if (history.length) {
      const transcript = history.map((item) => `${item.role === "assistant" ? "Bot" : "User"}: ${item.text}`).join("\n");
      requestPrompt = `You are Mahadi Hasan Bot’s chat assistant. Reply naturally and warmly in the language the user uses, usually Bangla or Bangla-English. Keep ordinary replies concise unless asked for detail. Use relevant context, do not invent personal facts, and do not claim to be a real human.\n\nRecent conversation:\n${transcript}\n\nNew user message: ${prompt}`;
    }
  }
  const answer = await askAI(requestPrompt, config);
  if (memoryEnabled && mongoDb && chatId && senderId) {
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
  }
  return answer;
}

export async function handleAutoAI(context) {
  const { body, remoteJid, sock, config, mongoSettingsCollection, mongoDb, message, sender, commandHandled } = context;
  if (commandHandled || message?.key?.fromMe || !body || /^(?:!|ai\s|font\s|learn\b|ping\b|status\b|alive\b)/i.test(body)) return false;
  const settings = await readAISettings(mongoSettingsCollection);
  if (!settings.autoChat) return false;
  if (remoteJid.endsWith("@g.us") && !settings.group) return false;
  if (remoteJid.endsWith("@s.whatsapp.net") && !settings.inbox) return false;
  const answer = await replyWithMemory({
    prompt: body,
    config,
    mongoDb,
    chatId: remoteJid,
    senderId: senderNumber(sender || message?.key?.participant || remoteJid),
    memoryEnabled: settings.memory
  });
  await sock.sendMessage(remoteJid, { text: answer }, { quoted: message });
  return true;
}

export default {
  name: "AI Chat",
  commands: ["ai"],
  aliases: ["chatgpt"],
  category: "AI",
  author: "Mahadi Hasan",
  description: "AI chat, opt-in auto-replies, per-sender conversation memory and persistent settings",
  usage: "!ai <message> | !ai on/off/status | !ai group on/off | !ai inbox on/off | !ai memory on/off | !ai forget",
  async execute(ctx) {
    const { sock, remoteJid, args, config, mongoSettingsCollection, mongoDb, message, sender } = ctx;
    const action = (args[0] || "").toLowerCase();
    const settings = await readAISettings(mongoSettingsCollection);
    const needsOwner = ["on", "off", "status", "group", "inbox", "memory", "forget"].includes(action);
    if (needsOwner && !ctx.isOwner && !ctx.isAdmin) {
      await sock.sendMessage(remoteJid, { text: "🔒 AI settings পরিবর্তনের অনুমতি নেই। Owner অথবা group admin প্রয়োজন।" }, { quoted: message });
      return;
    }
    if (action === "status") {
      await sock.sendMessage(remoteJid, { text: [
        "🤖 *Mahadi Hasan AI Status*",
        `Auto Chat: ${settings.autoChat ? "ON" : "OFF"}`,
        `Group: ${settings.group ? "ON" : "OFF"}`,
        `Inbox: ${settings.inbox ? "ON" : "OFF"}`,
        `Conversation Memory: ${settings.memory ? "ON" : "OFF"}`
      ].join("\n") }, { quoted: message });
      return;
    }
    if (["on", "off"].includes(action)) {
      settings.autoChat = action === "on";
      await saveAISettings(mongoSettingsCollection, settings);
      await sock.sendMessage(remoteJid, { text: `✅ AI Auto Chat ${action.toUpperCase()} — MongoDB-তে save হয়েছে।` }, { quoted: message });
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
      await sock.sendMessage(remoteJid, { text: `✅ AI ${action} ${value.toUpperCase()} — saved.` }, { quoted: message });
      return;
    }
    if (action === "forget") {
      const ownerSender = senderNumber(sender || remoteJid);
      if (!mongoDb) throw new Error("MongoDB is not connected");
      await mongoDb.collection("ai_memory").deleteMany({ chatId: remoteJid, senderId: ownerSender });
      await sock.sendMessage(remoteJid, { text: "🧹 এই chat-এর তোমার AI conversation memory মুছে দেওয়া হয়েছে।" }, { quoted: message });
      return;
    }

    const prompt = args.join(" ").trim();
    if (!prompt) {
      await sock.sendMessage(remoteJid, { text: [
        "🤖 *Mahadi Hasan AI*",
        "!ai <message> — AI-কে প্রশ্ন করো",
        "!ai on/off/status — Auto Chat control",
        "!ai group on/off — Group replies",
        "!ai inbox on/off — Private replies",
        "!ai memory on/off — Conversation context",
        "!ai forget — তোমার conversation memory clear",
        "Auto Chat default: OFF"
      ].join("\n") }, { quoted: message });
      return;
    }
    const answer = await replyWithMemory({
      prompt,
      config,
      mongoDb,
      chatId: remoteJid,
      senderId: senderNumber(sender || remoteJid),
      memoryEnabled: settings.memory
    });
    await sock.sendMessage(remoteJid, { text: answer }, { quoted: message });
  }
};
