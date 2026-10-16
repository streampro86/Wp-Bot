const logs = [];
let state = {
  connection: "starting",
  connected: false,
  connectedAt: null,
  startedAt: new Date().toISOString()
};

export function addLog(level, message) {
  const entry = { time: new Date().toISOString(), level, message: String(message) };
  logs.unshift(entry);
  if (logs.length > 150) logs.length = 150;
  const prefix = `[${entry.time}] [${level.toUpperCase()}]`;
  if (level === "error") console.error(prefix, message);
  else console.log(prefix, message);
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
