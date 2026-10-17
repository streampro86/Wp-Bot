# Mahadi Hasan WhatsApp Group Bot

Node.js + Baileys WhatsApp bot with a protected web dashboard, QR/pairing login, MongoDB-backed session storage, persistent plugin toggles, AI commands, and a numbered font selector.

## Included
- QR login shown in the web dashboard (not only in Render logs)
- Pairing-code login form
- HTTP Basic Authentication for dashboard and management APIs
- Plugin manager toggles persisted in MongoDB
- Dashboard buttons for WhatsApp logout and saved-session deletion
- Linked account name/ID shown on the protected dashboard
- `!ping`, `!status`, `!alive`, AI, and font commands
- Public `/health` JSON endpoint for UptimeRobot
- MongoDB URI and dashboard password supplied through Render environment variables; no `.env` file required

## Before deploying
1. Edit `config.js`.
2. Set the Render environment variable `DASHBOARD_PASSWORD` to a strong unique password. Dashboard username defaults to `admin`.
3. Set `MONGODB_URI` in Render to your private MongoDB Atlas URI.
4. Push the project to your own Git repository.

## Render
- Create a **Web Service** from the repository.
- Runtime: Node.
- Build command: `npm install`
- Start command: `npm start`
- Node version: 20 or newer.
- This project uses MongoDB Atlas for persistent WhatsApp credentials, so a Render Persistent Disk is not required. In `config.js`, keep `authStorage: "mongodb"` and add `MONGODB_URI` as a Render environment variable with your own Atlas connection URI before deploying, and set `DASHBOARD_PASSWORD`. The bot cannot persist login until a valid MongoDB URI is configured.
- Do not deploy multiple instances against the same WhatsApp session.

## UptimeRobot
Create an HTTP(s) monitor for:
`https://YOUR-SERVICE.onrender.com/health`

Expected response is HTTP 200 JSON with `ok: true`. UptimeRobot can check reachability, but it does not guarantee that a free Render service never sleeps or that WhatsApp stays connected.

## Commands
Use `!ping`, `!status`, or `!alive` in a group where the connected WhatsApp account is a member.

The bot supports group and private chats by default. Commands must appear at the start of a message. Moderation commands are not included unless a moderation plugin is added.

## Important
Baileys is an unofficial WhatsApp Web integration, not the official WhatsApp Cloud API. WhatsApp changes can interrupt the connection and unofficial automation can carry account restrictions risk. Use only with an account you control and respect group members' privacy.


## Pairing troubleshooting (updated)
- The app now attempts to fetch the current WhatsApp Web protocol version and uses a desktop Chrome browser identity.
- If the WhatsApp app still says “Couldn't link device”, this can be a Baileys/WhatsApp pairing-code compatibility issue, not necessarily a wrong phone number. Use the dashboard's QR login as the fallback: refresh the QR and scan it from WhatsApp → Linked Devices → Link a Device.
- The app treats Baileys `restartRequired` (status 515) as a reconnect request and opens a fresh socket.
- Do not repeatedly request codes in quick succession. Wait briefly between attempts.


## Commands and configuration

Commands work in groups and private chats by default. In `config.js`, `selfListen: true` enables processing messages sent by the linked account when Baileys emits them. `noPrefixEnabled: true` (default) accepts `ping`, `status`, and `alive`; `prefixEnabled: true` also accepts `!ping`, `!status`, and `!alive`. The command must be the first word in the message. Set either option to `false` to disable that style.

Plugins are split into `plugins/ping.js` and `plugins/status.js`; enable/disable them separately under `config.plugins`. Dashboard login defaults to username `admin`; the password must be supplied through the `DASHBOARD_PASSWORD` environment variable. The dashboard refuses authentication while the placeholder password is active.

A WhatsApp log with disconnect code `515` means Baileys was asked to restart the socket. The bot should reconnect automatically; wait for the dashboard to show `connected` before testing commands.

## Render Free: keep WhatsApp login after restart (MongoDB Atlas)

Render Free web services do not provide a persistent disk. This project can store Baileys credentials and encryption keys in MongoDB Atlas, which has a free tier. The Atlas database is a separate service and its free-tier availability/limits are controlled by MongoDB.

1. Create a MongoDB Atlas cluster and a database user.
2. Configure Atlas network access for Render. Use a strong database password and never share the URI.
3. Add the Atlas connection URI as Render environment variable `MONGODB_URI`; do not commit it to GitHub. Keep `authStorage: "mongodb"`.
4. Set `DASHBOARD_PASSWORD` in Render and deploy.
5. Pair/login once. Credentials and keys will be stored in MongoDB and can be reused after Render restarts/redeploys.

If `MONGODB_URI` is missing or invalid, persistent login cannot start. If you choose `authStorage: "local"`, login data is on Render's ephemeral filesystem and can be lost after a restart/redeploy.

### Dashboard credentials

Dashboard username defaults to `admin`; set `DASHBOARD_PASSWORD` in Render. Never commit a real MongoDB URI or dashboard password to a public GitHub repository.

### Commands

With no-prefix enabled, send `ping`, `status`, or `alive`. With prefix enabled, send `!ping`, `!status`, or `!alive`. Self-listen is enabled in config, but Baileys/WhatsApp may not deliver the linked account's own outgoing messages as ordinary incoming events in every situation; test commands from a second account if self-messages are not emitted.

## Final upgrade notes
- Bot display name and author are configured as `Mahadi Hasan` in `config.js`.
- Dashboard plugin ON/OFF changes are written to MongoDB collection `bot_settings` (document `_id: "plugins"`) and restored when MongoDB connects on startup.
- Set a real MongoDB Atlas URI in `config.js` before deploying. The placeholder URI is not usable.
- Change the dashboard password in `config.js` before making the dashboard accessible. Do not publish credentials in a public repository.
- `/health` is intended for uptime monitoring. The dashboard is protected by HTTP Basic Authentication; use HTTPS and a strong password.


## AI and font commands
- `!ai <message>` — send a prompt to the configured AI API.
- `!ai on/off/status` — control and inspect Auto Chat. Auto Chat defaults to OFF.
- `!ai group on/off` and `!ai inbox on/off` — configure Auto Chat destinations.
- `!font` — shows a numbered menu. Reply `1` Normal, `2` Fancy Script, `3` Bold, or `4` Monospace to save the font style. The menu message is deleted after selection where WhatsApp permits it.
- `!font fancy Your text`, `!font bold Your text`, `!font mono Your text` — convert text.
- `!font normal/fancy/bold/mono` — save the preferred font style directly in MongoDB.

The protected dashboard has separate **Log out WhatsApp** and **Delete saved session** controls. Both clear saved auth data and prepare a fresh login; logout also attempts to unlink the active WhatsApp session. Use these only when you intend to link the account again.

Render environment variables: `MONGODB_URI` (required for persistence) and `DASHBOARD_PASSWORD` (set a strong unique password). The MongoDB URI is read from the environment, never from plugin files.


## Owner setup and advanced AI features

Set `OWNER_NUMBER` in Render → Environment to the bot owner's full international phone number using digits only (no `+`, spaces, or dashes). Example format: `8801XXXXXXXXX`. Do not use the linked bot account number unless that is also the person who should own/administer the bot. Redeploy after changing environment variables.

Set `MONGODB_URI` and a strong `DASHBOARD_PASSWORD` in Render Environment. Dashboard username is `admin`. The AI control panel in the protected dashboard can switch Auto Chat, Group, Inbox, and Conversation Memory; changes are stored in MongoDB.

### AI commands
- `!ai <message>` — ask the AI; recent conversation context is stored per chat and sender.
- `!ai on/off/status` — owner/group-admin control of Auto Chat.
- `!ai group on/off`, `!ai inbox on/off`, `!ai memory on/off` — destination and memory controls.
- `!ai forget` — clear the current sender's saved AI conversation memory for that chat.
- Auto Chat defaults OFF.

### Consent-based learning commands
- `!learn on/off/status` — bot owner enables/disables the learning feature.
- `!learn optin` / `!learn optout` — each user controls whether their ordinary messages may be retained for learning while the feature is enabled. Opting out removes that user's stored learning entries in the current chat.
- `!learn add <text>` — explicitly save a note.
- `!learn list` — numbered list; reply to a number to view its details.
- `!learn forget` — delete your learning entries in the current chat.

Learning is opt-in; it should not be used to covertly collect other participants' messages. The current implementation stores opted-in messages/explicit notes; it is not model training or a claim that the external AI provider permanently learns from them.
