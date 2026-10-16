// Mahadi Hasan WhatsApp Bot — all settings live here; no .env required.
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
  port: 10000,

  // Dashboard login. Change this password before sharing your repository.
  dashboard: {
    username: "admin",
    password: "Mahadi@2026#Admin"
  },

  // Optional: international digits only, e.g. Bangladesh 8801XXXXXXXXX.
  pairingNumber: "",
  // Recommended for Render Free: use a free MongoDB Atlas cluster to persist WhatsApp login.
  // Paste the Atlas connection URI below; keep this file private because it contains credentials.
  authStorage: "mongodb", // "mongodb" persists login; "local" is not persistent on Render Free
  // Example format: mongodb+srv://DB_USER:DB_PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
  // Replace this placeholder with your own private Atlas URI before deploying.
  mongoUri: "mongodb+srv://devxhasu_db_user:xB9tRKDfuKQyEzC2@cluster0.32iypog.mongodb.net/hasu_bot?retryWrites=true&w=majority",
  mongoDbName: "mahadi_whatsapp_bot",
  mongoAuthCollection: "baileys_auth",
  // Used only when authStorage is "local" or MongoDB is intentionally disabled.
  sessionDirectory: "./storage/session",
  maxLogEntries: 150,

  plugins: {
    ping: true,
    status: true
  }
};
