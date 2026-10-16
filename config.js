// Mahadi Hasan WhatsApp Bot — edit settings here. No .env file is required.
export default {
  botName: "Mahadi Hasan",
  author: "Mahadi Hasan",
  prefix: "!",
  port: 10000,

  // Change these before deploying. Dashboard routes are protected by this login.
  dashboard: {
    username: "admin",
    password: "CHANGE-THIS-STRONG-PASSWORD"
  },

  // Optional: put your WhatsApp number here for pairing-code login.
  // International digits only, e.g. Bangladesh: 8801XXXXXXXXX (no +, spaces or dashes).
  pairingNumber: "",

  // Persistent session directory. On Render, attach a persistent disk at /var/data
  // and change this to "/var/data/session".
  sessionDirectory: "./storage/session",

  // Keep logs in memory for the dashboard; not a permanent audit database.
  maxLogEntries: 150,

  plugins: {
    pingStatus: true
  }
};
