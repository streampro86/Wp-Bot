const MEMORY_LIMIT = 14;
const GLOBAL_DEFAULTS = Object.freeze({
  inbox: true,       // global: private chat auto AI
  memory: true,
  inboxAllow: []     // if non-empty, only these numbers get inbox AI
});

function asBool(v) {
  if (v === true || v === 1 || v === "1" || v === "true" || v === "on" || v === "ON") return true;
  return false;
}

function senderNumber(sender = "") {
  return String(sender).split("@")[0].split(":")[0].replace(/\D/g, "");
}

function isGroupJid(jid = "") {
  return String(jid).endsWith("@g.us");
}

async function readGlobal(collection) {
  if (!collection) return { ...GLOBAL_DEFAULTS, inboxAllow: [] };
  const doc = await collection.findOne({ _id: "ai" });
  const raw = doc?.values || {};
  return {
    inbox: raw.inbox === undefined ? true : asBool(raw.inbox),
    memory: raw.memory === undefined ? true : asBool(raw.memory),
    inboxAllow: Array.isArray(raw.inboxAllow) ? raw.inboxAllow.map((n) => String(n).replace(/\D/g, "")).filter(Boolean) : []
  };
}

async function saveGlobal(collection, patch) {
  if (!collection) throw new Error("MongoDB settings are not available");
  const cur = await readGlobal(collection);
  const next = {
    inbox: patch.inbox !== undefined ? asBool(patch.inbox) : cur.inbox,
    memory: patch.memory !== undefined ? asBool(patch.memory) : cur.memory,
    inboxAllow: patch.inboxAllow !== undefined ? patch.inboxAllow : cur.inboxAllow
  };
  await collection.updateOne(
    { _id: "ai" },
    { $set: { values: next, updatedAt: new Date() } },
    { upsert: true }
  );
  return next;
}

/** Per-group auto on/off. Default OFF until !ai on in that group. */
async function readGroupAuto(collection, groupJid) {
  if (!collection || !groupJid) return false;
  const doc = await collection.findOne({ _id: `ai_group:${groupJid}` });
  return asBool(doc?.autoChat);
}

async function saveGroupAuto(collection, groupJid, enabled) {
  if (!collection) throw new Error("MongoDB settings are not available");
  await collection.updateOne(
    { _id: `ai_group:${groupJid}` },
    { $set: { autoChat: asBool(enabled), updatedAt: new Date() } },
    { upsert: true }
  );
  return asBool(enabled);
}

/** Resolve whether auto AI should reply in this chat for this sender */
async function shouldAutoReply(collection, remoteJid, senderId) {
  const global = await readGlobal(collection);
  if (isGroupJid(remoteJid)) {
    const on = await readGroupAuto(collection, remoteJid);
    return { ok: on === true, reason: on ? "group ON" : "group OFF (!ai on in this group)", global };
  }
  // Inbox / private
  if (global.inbox !== true) {
    return { ok: false, reason: "inbox global OFF (!ai inbox on)", global };
  }
  if (global.inboxAllow.length > 0) {
    const num = senderNumber(senderId);
    const allowed = global.inboxAllow.some((n) => n === num || num.endsWith(n) || n.endsWith(num.slice(-10)));
    if (!allowed) {
      return { ok: false, reason: `number not in inbox allow list (${num})`, global };
    }
  }
  return { ok: true, reason: "inbox ON", global };
}

const MAHADI_SYSTEM = `
তুমি Mahadi Hasan। ভদ্র বাংলাদেশি মানুষ। সবসময় "আপনি" বলো।

সবচেয়ে গুরুত্বপূর্ণ:
1) User-এর সর্বশেষ message-এর সরাসরি উত্তর দাও।
2) একই উত্তর দুইবার দিও না। সালাম বারবার নিষেধ।
3) Learned notes থাকলে সত্যি তথ্য হিসেবে ব্যবহার করো।
4) ছোট reply (১–২ লাইন)। Robot ভাষা নয়। নাম প্রিফিক্স লিখবে না।

সালাম: user সালাম দিলে ওয়ালাইকুম সালাম। অন্য message এ সালাম দিও না।
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
  return t.replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
}

async function setTyping(sock, remoteJid, on = true) {
  try { await sock.sendPresenceUpdate(on ? "composing" : "paused", remoteJid); } catch { /* ignore */ }
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
      headers: { accept: "application/json", "user-agent": "MahadiHasanBot/2.5" }
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
    if (!answer) throw new Error("AI API response did not contain a reply");
    addLog?.("success", `AI reply ok (${answer.length} chars)`);
    return cleanReply(answer);
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`AI timeout after ${timeoutMs}ms`);
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
  if (!mongoDb) return [];
  try {
    const digits = String(senderId || "").replace(/\D/g, "");
    const q = {
      $or: [
        { chatId, senderId },
        { chatId, senderId: digits },
        { chatId, scope: "chat" },
        { scope: "global" }
      ]
    };
    if (digits.length >= 10) {
      q.$or.push({ senderId: { $regex: digits.slice(-10) } });
    }
    const rows = await mongoDb.collection("learning_entries")
      .find(q)
      .sort({ createdAt: -1 })
      .limit(12)
      .toArray();
    return rows.map((r) => String(r.text || "").trim().slice(0, 400)).filter(Boolean);
  } catch {
    return [];
  }
}

async function replyWithMemory({ prompt, config, mongoDb, chatId, senderId, memoryEnabled, addLog }) {
  let extra = "";
  if (memoryEnabled && mongoDb && chatId && senderId) {
    const history = await getConversationContext(mongoDb, chatId, senderId);
    if (history.length) {
      extra += "\n\nআগের কথোপকথন:\n" + history.map((i) => `${i.role === "assistant" ? "Mahadi" : "User"}: ${i.text}`).join("\n");
    }
  }
  if (mongoDb) {
    const notes = await getLearningNotes(mongoDb, chatId, senderId);
    if (notes.length) {
      extra += "\n\nশিখে রাখা তথ্য (সত্য হিসেবে ব্যবহার করো):\n- " + notes.join("\n- ");
      addLog?.("info", `AI using ${notes.length} learned note(s)`);
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
        ban = "\n\nআগের উত্তর (repeat নিষেধ):\n" + last.map((x) => `- ${String(x.text).slice(0, 120)}`).join("\n");
      }
    } catch { /* ignore */ }
  }

  const requestPrompt = `${MAHADI_SYSTEM}${extra}${ban}\n\nUser-এর নতুন message: ${prompt}\n\nশুধু এই message-এর relevant উত্তর (আপনি বলে, নাম প্রিফিক্স ছাড়া):`;
  let answer = await askAI(requestPrompt, config, addLog);

  if (ban && answer) {
    const prev = ban.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim().toLowerCase());
    const norm = answer.toLowerCase().replace(/\s+/g, " ");
    if (prev.some((p) => p && (norm.includes(p.slice(0, 35)) || p.includes(norm.slice(0, 35))))) {
      addLog?.("warn", "AI repeated — retry");
      answer = await askAI(
        `${MAHADI_SYSTEM}\n\nUser: ${prompt}\n\nআগের মতো উত্তর নিষেধ। নতুন করে, সালাম ছাড়া:`,
        config,
        addLog
      );
    }
  }

  if (memoryEnabled && mongoDb && chatId && senderId) {
    try {
      const col = mongoDb.collection("ai_memory");
      await col.insertMany([
        { chatId, senderId, role: "user", text: prompt.slice(0, 2000), createdAt: new Date() },
        { chatId, senderId, role: "assistant", text: answer.slice(0, 4000), createdAt: new Date() }
      ]);
      const count = await col.countDocuments({ chatId, senderId });
      if (count > MEMORY_LIMIT * 2) {
        const old = await col.find({ chatId, senderId }).sort({ createdAt: 1 }).limit(count - MEMORY_LIMIT * 2).project({ _id: 1 }).toArray();
        if (old.length) await col.deleteMany({ _id: { $in: old.map((x) => x._id) } });
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
    addLog?.("debug", "Auto AI skip: linked bot number");
    return false;
  }
  if (!body) return false;
  if (/^(?:!|ai\s|font\s|learn\b|ping\b|status\b|alive\b|help\b|menu\b|commands\b|owner\b|myid\b)/i.test(body)) return false;

  const decision = await shouldAutoReply(
    mongoSettingsCollection,
    remoteJid,
    sender || message?.key?.participant || remoteJid
  );
  if (!decision.ok) {
    addLog?.("info", `Auto AI skip: ${decision.reason}`);
    return false;
  }

  try {
    addLog?.("info", `Auto AI generating (${decision.reason})…`);
    await setTyping(sock, remoteJid, true);
    const answer = await replyWithMemory({
      prompt: body,
      config,
      mongoDb,
      chatId: remoteJid,
      senderId: senderNumber(sender || message?.key?.participant || remoteJid),
      memoryEnabled: decision.global.memory,
      addLog
    });
    let text = answer;
    if (typeof applySavedFont === "function") {
      try { text = await applySavedFont(answer, mongoSettingsCollection); } catch { /* ignore */ }
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
  description: "Per-group AI, global inbox, per-number allow, memory + learn",
  usage: "!ai on/off | !ai inbox on/off [number] | !ai status | !ai <msg>",
  async execute(ctx) {
    const { sock, remoteJid, args, config, mongoSettingsCollection, mongoDb, message, sender, addLog } = ctx;
    const action = (args[0] || "").toLowerCase();
    const needsOwner = ["on", "off", "status", "inbox", "memory", "forget", "allow", "deny"].includes(action);

    if (needsOwner && !ctx.isOwner && !ctx.isAdmin) {
      await sock.sendMessage(remoteJid, {
        text: "🔒 Access nai.\nEi command shudhu *Owner* ba group admin."
      }, { quoted: message });
      return;
    }

    // !ai on / off  → this group only (or inbox uses global inbox flag)
    if (["on", "off"].includes(action)) {
      const enable = action === "on";
      if (isGroupJid(remoteJid)) {
        await saveGroupAuto(mongoSettingsCollection, remoteJid, enable);
        addLog?.("info", `Group ${remoteJid} autoChat=${enable}`);
        await sock.sendMessage(remoteJid, {
          text: enable
            ? "✅ *Ei group* e AI Auto *ON*\nEkhon ei group e normal message e reply dibe."
            : "✅ *Ei group* e AI Auto *OFF*\nEi group e auto reply bandho."
        }, { quoted: message });
      } else {
        // In private chat, on/off controls global inbox
        await saveGlobal(mongoSettingsCollection, { inbox: enable });
        addLog?.("info", `Inbox global autoChat/inbox=${enable}`);
        await sock.sendMessage(remoteJid, {
          text: enable
            ? "✅ *Inbox AI* global *ON*"
            : "✅ *Inbox AI* global *OFF*"
        }, { quoted: message });
      }
      return;
    }

    // !ai inbox on/off
    // !ai inbox on 8801xxxx
    // !ai inbox off 8801xxxx
    if (action === "inbox") {
      const sub = String(args[1] || "").toLowerCase();
      const numArg = String(args[2] || args[1] || "").replace(/\D/g, "");
      // !ai inbox on 8801...  OR  !ai inbox off 8801...
      if ((sub === "on" || sub === "off") && args[2] && numArg.length >= 10) {
        const global = await readGlobal(mongoSettingsCollection);
        let list = [...global.inboxAllow];
        if (sub === "on") {
          if (!list.includes(numArg)) list.push(numArg);
          await saveGlobal(mongoSettingsCollection, { inboxAllow: list, inbox: true });
          await sock.sendMessage(remoteJid, {
            text: `✅ Inbox AI *ON* for number:\n*${numArg}*\n\nAllow list: ${list.join(", ") || "all"}`
          }, { quoted: message });
        } else {
          list = list.filter((n) => n !== numArg && !n.endsWith(numArg.slice(-10)));
          await saveGlobal(mongoSettingsCollection, { inboxAllow: list });
          await sock.sendMessage(remoteJid, {
            text: `✅ Number *${numArg}* inbox allow list theke remove.\nList: ${list.length ? list.join(", ") : "(empty = sob number allowed jodi inbox ON)"}`
          }, { quoted: message });
        }
        return;
      }
      if (sub === "on" || sub === "off") {
        await saveGlobal(mongoSettingsCollection, { inbox: sub === "on" });
        await sock.sendMessage(remoteJid, {
          text: sub === "on"
            ? "✅ *Inbox AI* global *ON* (private chats)"
            : "✅ *Inbox AI* global *OFF*"
        }, { quoted: message });
        return;
      }
      // !ai inbox 8801... as allow
      if (numArg.length >= 10) {
        const global = await readGlobal(mongoSettingsCollection);
        const list = [...global.inboxAllow];
        if (!list.includes(numArg)) list.push(numArg);
        await saveGlobal(mongoSettingsCollection, { inboxAllow: list, inbox: true });
        await sock.sendMessage(remoteJid, {
          text: `✅ Inbox allow: *${numArg}*\nList: ${list.join(", ")}`
        }, { quoted: message });
        return;
      }
      await sock.sendMessage(remoteJid, {
        text: [
          "Inbox controls:",
          "!ai inbox on/off — global private AI",
          "!ai inbox on 8801XXXXXXXXX — allow number",
          "!ai inbox off 8801XXXXXXXXX — remove number"
        ].join("\n")
      }, { quoted: message });
      return;
    }

    if (action === "memory") {
      const value = String(args[1] || "").toLowerCase();
      if (!["on", "off"].includes(value)) {
        await sock.sendMessage(remoteJid, { text: "Usage: !ai memory on/off" }, { quoted: message });
        return;
      }
      await saveGlobal(mongoSettingsCollection, { memory: value === "on" });
      await sock.sendMessage(remoteJid, { text: `✅ AI memory *${value.toUpperCase()}*` }, { quoted: message });
      return;
    }

    if (action === "status") {
      const global = await readGlobal(mongoSettingsCollection);
      const groupOn = isGroupJid(remoteJid) ? await readGroupAuto(mongoSettingsCollection, remoteJid) : null;
      const lines = [
        "🤖 *Mahadi Hasan AI Status*",
        isGroupJid(remoteJid)
          ? `This group auto: ${groupOn ? "ON ✅" : "OFF"}`
          : `Inbox (this chat): use global inbox`,
        `Inbox global: ${global.inbox ? "ON ✅" : "OFF"}`,
        `Memory: ${global.memory ? "ON ✅" : "OFF"}`,
        `Inbox allow list: ${global.inboxAllow.length ? global.inboxAllow.join(", ") : "(empty = all numbers)"}`
      ];
      await sock.sendMessage(remoteJid, { text: lines.join("\n") }, { quoted: message });
      return;
    }

    if (action === "forget") {
      const sid = senderNumber(sender || remoteJid);
      if (!mongoDb) throw new Error("MongoDB is not connected");
      await mongoDb.collection("ai_memory").deleteMany({ chatId: remoteJid, senderId: sid });
      await sock.sendMessage(remoteJid, { text: "🧹 Ei chat er AI memory clear." }, { quoted: message });
      return;
    }

    const prompt = args.join(" ").trim();
    if (!prompt) {
      await sock.sendMessage(remoteJid, {
        text: [
          "🤖 *Mahadi Hasan AI*",
          "",
          "Group e:",
          "  !ai on / off — *ei group* er auto",
          "",
          "Inbox:",
          "  !ai inbox on/off — global",
          "  !ai inbox on 8801XXX — number allow",
          "  !ai inbox off 8801XXX — number remove",
          "",
          "!ai status | !ai memory on/off | !ai forget",
          "!ai <message> — direct ask"
        ].join("\n")
      }, { quoted: message });
      return;
    }

    try {
      const global = await readGlobal(mongoSettingsCollection);
      await setTyping(sock, remoteJid, true);
      const answer = await replyWithMemory({
        prompt,
        config,
        mongoDb,
        chatId: remoteJid,
        senderId: senderNumber(sender || remoteJid),
        memoryEnabled: global.memory,
        addLog
      });
      let text = answer;
      try {
        const { applySavedFont } = await import("../src/utils/font.js");
        text = await applySavedFont(answer, mongoSettingsCollection);
      } catch { /* ignore */ }
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
