// Mahadi Hasan WhatsApp Bot — secrets are supplied through Render environment variables.
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
  ownerJid: String(process.env.OWNER_NUMBER || "").replace(/\D/g, ""),

  // Dashboard login. Change this password before sharing your repository.
  dashboard: {
    username: "admin",
    password: process.env.DASHBOARD_PASSWORD || "CHANGE-THIS-STRONG-PASSWORD"
  },

  // Optional: international digits only, e.g. Bangladesh 8801XXXXXXXXX.
  pairingNumber: "",
  // Recommended for Render Free: use a free MongoDB Atlas cluster to persist WhatsApp login.
  // Paste the Atlas connection URI below; keep this file private because it contains credentials.
  authStorage: "mongodb", // "mongodb" persists login; "local" is not persistent on Render Free
  // Example format: mongodb+srv://DB_USER:DB_PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
  // Set MONGODB_URI in Render Environment; do not commit credentials.
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
  ai: { endpoint: "https://hasan-indol.vercel.app/api/chat", provider: "auto", timeoutMs: 20000 }
};
