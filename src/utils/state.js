const logs = [];
let state = {
  connection: "starting",
  connected: false,
  connectedAt: null,
  startedAt: new Date().toISOString()
};

const LEVEL_EMOJI = {
  success: "✅",
  info: "ℹ️",
  warn: "⚠️",
  error: "❌",
  debug: "🔍",
  receive: "📥",
  send: "📤"
};

export function addLog(level, message) {
  const lvl = String(level || "info").toLowerCase();
  const emoji = LEVEL_EMOJI[lvl] || "•";
  const entry = {
    time: new Date().toISOString(),
    level: lvl,
    message: String(message)
  };
  logs.unshift(entry);
  if (logs.length > 150) logs.length = 150;

  const timeShort = entry.time.slice(11, 19);
  const line = `[${timeShort}] ${emoji} ${entry.message}`;
  if (lvl === "error") console.error(line);
  else console.log(line);
}

export function getLogs() { return logs; }
export function setBotState(update) { state = { ...state, ...update }; }
export function getBotState() {
  return {
    ...state,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
  };
}
