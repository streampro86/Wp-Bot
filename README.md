# Mahadi Hasan WhatsApp Group Bot

Starter project using Node.js, Baileys, a protected web dashboard, QR/pairing login, plugin loader, and one `ping/status/alive` plugin.

## Included
- QR login shown in the web dashboard (not only in Render logs)
- Pairing-code login form
- HTTP Basic Authentication for dashboard and management APIs
- Plugin manager toggle
- `!ping`, `!status`, `!alive` in group chats
- Public `/health` JSON endpoint for UptimeRobot
- MongoDB URI and dashboard password supplied through Render environment variables; no `.env` file required

## Before deploying
1. Edit `config.js`.
2. Change `dashboard.username` and set a strong `dashboard.password`. The dashboard refuses login while the default password remains.
3. Set `port` to `10000` (Render default in this starter).
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

This starter deliberately processes group chats only and only reacts when the command starts the message. It does not include kick/ban or other moderation plugins yet; those can be added separately.

## Important
Baileys is an unofficial WhatsApp Web integration, not the official WhatsApp Cloud API. WhatsApp changes can interrupt the connection and unofficial automation can carry account restrictions risk. Use only with an account you control and respect group members' privacy.


## Pairing troubleshooting (updated)
- The app now attempts to fetch the current WhatsApp Web protocol version and uses a desktop Chrome browser identity.
- If the WhatsApp app still says “Couldn't link device”, this can be a Baileys/WhatsApp pairing-code compatibility issue, not necessarily a wrong phone number. Use the dashboard's QR login as the fallback: refresh the QR and scan it from WhatsApp → Linked Devices → Link a Device.
- The app treats Baileys `restartRequired` (status 515) as a reconnect request and opens a fresh socket.
- Do not repeatedly request codes in quick succession. Wait briefly between attempts.


## Commands and configuration

Commands work in groups and private chats by default. In `config.js`, `selfListen: true` enables processing messages sent by the linked account when Baileys emits them. `noPrefixEnabled: true` (default) accepts `ping`, `status`, and `alive`; `prefixEnabled: true` also accepts `!ping`, `!status`, and `!alive`. The command must be the first word in the message. Set either option to `false` to disable that style.

Plugins are split into `plugins/ping.js` and `plugins/status.js`; enable/disable them separately under `config.plugins`. Dashboard login defaults to username `admin` and password `Mahadi@2026#Admin` in this build. Change it in `config.js` before sharing the repository.

A WhatsApp log with disconnect code `515` means Baileys was asked to restart the socket. The bot should reconnect automatically; wait for the dashboard to show `connected` before testing commands.

## Render Free: keep WhatsApp login after restart (MongoDB Atlas)

Render Free web services do not provide a persistent disk. This project can store Baileys credentials and encryption keys in MongoDB Atlas, which has a free tier. The Atlas database is a separate service and its free-tier availability/limits are controlled by MongoDB.

1. Create a free MongoDB Atlas cluster and a database user.
2. In Atlas, allow network access from Render. For the simplest setup, Atlas may allow `0.0.0.0/0`; use a strong database password because this permits connections from any IP, and never share the URI.
3. Copy the Node.js connection URI from Atlas, replacing the password placeholder with the database user's password.
4. In this project's `config.js`, set `mongoUri` to that URI. Keep `authStorage: "mongodb"`.
5. Push the updated project to GitHub and deploy it on Render. Do not delete the Atlas database or the `baileys_auth` collection after linking.
6. Pair/login once. Credentials and keys will be stored in MongoDB and can be reused after Render restarts/redeploys.

If `mongoUri` is still `PASTE_MONGODB_ATLAS_URI_HERE`, the bot intentionally logs a clear startup error instead of pretending the session is persistent. If you choose `authStorage: "local"`, login data is on Render's ephemeral filesystem and can be lost after a restart/redeploy.

### Dashboard credentials

The default dashboard credentials are `admin` / `Mahadi@2026#Admin`. Change the password in `config.js` before using the dashboard publicly. Do not commit a real MongoDB URI to a public GitHub repository.

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
- `!font fancy Your text`, `!font bold Your text`, `!font mono Your text` — convert text.
- `!font normal/fancy/bold/mono` — save the preferred font style in MongoDB.

Render environment variables: `MONGODB_URI` (required for persistence) and `DASHBOARD_PASSWORD` (set a strong unique password). The MongoDB URI is read from the environment, never from plugin files.
