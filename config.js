// Mahadi Hasan WhatsApp Bot — secrets are supplied through environment variables.
export default {
  botName: "Mahadi Hasan",
  author: "Mahadi Hasan",
  prefix: "!",
  // Both command styles are enabled by default: !ping and ping.
  prefixEnabled: true,
  noPrefixEnabled: true,
  // Allow commands sent by the linked WhatsApp account itself.
  selfListen: true,
  // true = only groups; false = groups and private chats.
  groupOnly: false,
  port: Number(process.env.PORT || 10000),

  // ========== OWNER SYSTEM ==========
  // Primary owner (backward compatible). Use international digits only, e.g. 8801XXXXXXXXX
  ownerJid: String(process.env.OWNER_NUMBER || "").replace(/\D/g, ""),
  // Multiple owners supported. Add numbers here or via OWNER_NUMBERS env (comma separated).
  // Example: owners: ["8801XXXXXXXXX", "8801YYYYYYYYY"]
  owners: [
    // Primary owner will be auto-added from ownerJid / OWNER_NUMBER at runtime
  ].concat(
    String(process.env.OWNER_NUMBERS || "")
      .split(",")
      .map((n) => n.replace(/\D/g, ""))
      .filter(Boolean)
  ),

  // Dashboard login. Change this password before sharing your repository.
  dashboard: {
    username: "admin",
    password: process.env.DASHBOARD_PASSWORD || "CHANGE-THIS-STRONG-PASSWORD"
  },

  // Optional: international digits only, e.g. Bangladesh 8801XXXXXXXXX.
  pairingNumber: "",
  // Recommended for Render Free: use a free MongoDB Atlas cluster to persist WhatsApp login.
  authStorage: "mongodb", // "mongodb" persists login; "local" is not persistent on Render Free
  // Set MONGODB_URI in environment; do not commit credentials.
  mongoUri: process.env.MONGODB_URI || "",
  mongoDbName: "mahadi_whatsapp_bot",
  mongoAuthCollection: "baileys_auth",
  // Used only when authStorage is "local" or MongoDB is intentionally disabled.
  sessionDirectory: "./storage/session",
  maxLogEntries: 150,

  plugins: {
    ping: true,
    status: true,
    ai: true,
    font: true,
    learn: true
  },

  // AI settings — primary endpoint
  ai: {
    endpoint: process.env.AI_ENDPOINT || "https://hasan-indol.vercel.app/api/chat",
    provider: process.env.AI_PROVIDER || "auto",
    timeoutMs: 25000
  }
};
