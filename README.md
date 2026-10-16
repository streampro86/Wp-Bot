# Mahadi Hasan WhatsApp Group Bot

Starter project using Node.js, Baileys, a protected web dashboard, QR/pairing login, plugin loader, and one `ping/status/alive` plugin.

## Included
- QR login shown in the web dashboard (not only in Render logs)
- Pairing-code login form
- HTTP Basic Authentication for dashboard and management APIs
- Plugin manager toggle
- `!ping`, `!status`, `!alive` in group chats
- Public `/health` JSON endpoint for UptimeRobot
- Settings in `config.js`; no `.env` file required

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
- For persistent WhatsApp sessions, attach a persistent disk at `/var/data`, then set `sessionDirectory` in `config.js` to `/var/data/session`. Render documents persistent disks as paid-plan functionality; without persistent storage, sessions may be lost on redeploy/restart.
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
