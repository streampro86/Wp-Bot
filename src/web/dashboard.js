import QRCode from "qrcode";
import os from "node:os";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function createDashboard(app, deps) {
  const { config, getLoginArtifacts, requestPairingCode, pluginModules, getLogs, getBotState, addLog } = deps;

  // Public health endpoint for UptimeRobot. It does not expose credentials/session data.
  app.get("/health", (_req, res) => {
    const state = getBotState();
    res.status(200).json({
      ok: true,
      service: config.botName,
      status: state.connection,
      whatsappConnected: state.connected,
      uptimeSeconds: state.uptimeSeconds,
      time: new Date().toISOString()
    });
  });

  // Basic auth protects dashboard and its management APIs.
  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");
    if (scheme !== "Basic" || !encoded) {
      res.set("WWW-Authenticate", 'Basic realm="Mahadi Hasan Bot Dashboard"');
      return res.status(401).send("Login required");
    }
    let decoded = "";
    try { decoded = Buffer.from(encoded, "base64").toString("utf8"); } catch {}
    const sep = decoded.indexOf(":");
    const username = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);
    if (username !== config.dashboard.username || password !== config.dashboard.password
      || config.dashboard.password === "CHANGE-THIS-STRONG-PASSWORD") {
      return res.status(401).send("Invalid dashboard login. Set a strong password in config.js.");
    }
    next();
  });

  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(config.botName)} Dashboard</title>
<style>
:root{color-scheme:dark}body{font:15px system-ui;background:#0b1220;color:#edf2ff;margin:0}
header{padding:22px 5%;background:#121d31;border-bottom:1px solid #26354e}h1{margin:0;font-size:24px}
main{max-width:1050px;margin:24px auto;padding:0 16px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.card{background:#121d31;border:1px solid #26354e;border-radius:14px;padding:18px;min-width:0}
h2{font-size:18px;margin:0 0 12px}.muted{color:#9eacc6}.pill{display:inline-block;padding:5px 10px;border-radius:20px;background:#233653}
button,input{font:inherit;border-radius:8px;padding:10px;border:1px solid #3a4c69;background:#0b1220;color:#fff}
button{cursor:pointer;background:#2365d8;border:0;margin:5px 4px 5px 0}button:disabled{opacity:.5}
input{width:100%;box-sizing:border-box;margin:6px 0 10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0b1220;padding:12px;border-radius:8px}
#qr{width:250px;max-width:100%;background:white;padding:8px;border-radius:8px;display:none}
.log{font:12px ui-monospace,monospace;padding:7px 0;border-bottom:1px solid #26354e;overflow-wrap:anywhere}
a{color:#9ec5ff}.row{display:flex;gap:8px;flex-wrap:wrap}.small{font-size:12px}
</style></head><body>
<header><h1>👑 ${escapeHtml(config.botName)}</h1><div class="muted">WhatsApp Group Bot · Plugin Dashboard · by ${escapeHtml(config.author)}</div></header>
<main>
<section class="card"><h2>Connection Status</h2><div id="status" class="pill">Loading…</div><p class="muted" id="details">Fetching status</p>
<div class="row"><button onclick="refreshAll()">Refresh</button><a href="/health" target="_blank">Health endpoint</a></div>
<p class="small muted">Pairing codes and QR images are sensitive. Do not share them.</p></section>
<section class="card"><h2>QR Login</h2><p class="muted">Open WhatsApp → Linked Devices → Link a Device, then scan.</p>
<img id="qr" alt="WhatsApp login QR"><p id="qrMsg" class="muted">Waiting for QR…</p><button onclick="refreshQR()">Refresh QR</button></section>
<section class="card"><h2>Pairing Code Login</h2><form id="pairForm"><label for="phone">Phone number with country code (digits only)</label>
<input id="phone" placeholder="8801XXXXXXXXX" autocomplete="off" required minlength="8" maxlength="15">
<button type="submit">Generate Pairing Code</button></form><pre id="pairCode">No pairing code requested</pre><p class="small muted" id="pairMsg"></p></section>
<section class="card"><h2>Plugin Manager</h2><p class="muted">Separate Ping and Status plugins. Toggle takes effect immediately.</p><div id="plugins">Loading…</div></section>
<section class="card"><h2>System</h2><div id="system" class="muted">Loading…</div></section>
<section class="card"><h2>Recent Logs</h2><div id="logs">Loading…</div></section>
</main>
<script>
async function api(url, options={}) {
 const r=await fetch(url,{headers:{'Content-Type':'application/json'},...options});
 const data=await r.json().catch(()=>({error:'Invalid response'}));
 if(!r.ok) throw new Error(data.error||'Request failed'); return data;
}
async function refreshAll(){
 try{
  const d=await api('/api/status'); document.getElementById('status').textContent=d.state.connection;
  document.getElementById('details').textContent='WhatsApp: '+(d.state.connected?'Connected':'Not connected')+' · Uptime: '+d.state.uptimeSeconds+' sec';
  document.getElementById('system').textContent='Node '+d.node+' · Memory '+d.state.memoryMB+' MB · Host '+d.hostname;
  document.getElementById('plugins').innerHTML=d.plugins.map(p=>'<div class="row" style="align-items:center;justify-content:space-between;margin:8px 0"><span>'+p.name+'</span><button onclick="togglePlugin(\\''+p.key+'\\','+(!p.enabled)+')">'+(p.enabled?'Disable':'Enable')+'</button></div>').join('')||'No plugins loaded';
  document.getElementById('logs').innerHTML=d.logs.map(l=>'<div class="log">['+l.time+'] ['+l.level.toUpperCase()+'] '+l.message.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</div>').join('')||'No logs';
 }catch(e){document.getElementById('details').textContent=e.message}
}
async function refreshQR(){
 try{const d=await api('/api/qr');const img=document.getElementById('qr');
 if(d.dataUrl){img.src=d.dataUrl;img.style.display='block';document.getElementById('qrMsg').textContent='Scan this QR from WhatsApp Linked Devices.'}
 else{img.style.display='none';document.getElementById('qrMsg').textContent=d.connected?'Already connected.': 'QR not available yet. Refresh in a few seconds.'}
 if(d.pairingCode)document.getElementById('pairCode').textContent=d.pairingCode;
 }catch(e){document.getElementById('qrMsg').textContent=e.message}
}
document.getElementById('pairForm').addEventListener('submit',async e=>{
 e.preventDefault();const box=document.getElementById('pairMsg');box.textContent='Requesting code…';
 try{const d=await api('/api/pairing',{method:'POST',body:JSON.stringify({phone:document.getElementById('phone').value})});
 document.getElementById('pairCode').textContent=d.code;box.textContent='On WhatsApp: Linked Devices → Link a Device → Link with phone number.';refreshAll();
 }catch(err){box.textContent=err.message}
});
async function togglePlugin(key,enabled){try{await api('/api/plugins/toggle',{method:'POST',body:JSON.stringify({key,enabled})});refreshAll()}catch(e){alert(e.message)}}
refreshAll();refreshQR();setInterval(refreshAll,5000);setInterval(refreshQR,7000);
</script></body></html>`);
  });

  app.get("/api/status", (_req, res) => {
    const plugins = [...pluginModules.entries()].map(([key, plugin]) => ({
      key, name: plugin.name || key, enabled: config.plugins[key] !== false
    }));
    res.json({ state: getBotState(), plugins, logs: getLogs().slice(0, 50), node: process.version, hostname: os.hostname() });
  });

  app.get("/api/qr", async (_req, res) => {
    try {
      const artifacts = getLoginArtifacts();
      const dataUrl = artifacts.qr ? await QRCode.toDataURL(artifacts.qr, { width: 300, margin: 2 }) : null;
      res.json({
        dataUrl: artifacts.qr ? dataUrl : null,
        pairingCode: artifacts.pairingCode,
        connected: getBotState().connected,
        connection: getBotState().connection
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/pairing", async (req, res) => {
    try {
      const code = await requestPairingCode(req.body?.phone);
      res.json({ ok: true, code });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/plugins/toggle", (req, res) => {
    const { key, enabled } = req.body || {};
    if (!pluginModules.has(key)) return res.status(404).json({ error: "Plugin not found" });
    config.plugins[key] = Boolean(enabled);
    addLog("info", `Plugin ${key} ${config.plugins[key] ? "enabled" : "disabled"} from dashboard`);
    res.json({ ok: true, key, enabled: config.plugins[key] });
  });
}
