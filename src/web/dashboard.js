import QRCode from "qrcode";
import os from "node:os";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function createDashboard(app, deps) {
  const { config, getLoginArtifacts, requestPairingCode, pluginModules, getLogs, getBotState, getBotIdentity, dashboardLogout, dashboardDeleteSession, addLog, savePluginSetting, getMongoSettingsCollection, getMongoDb } = deps;

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
 :root{color-scheme:dark}*{box-sizing:border-box}body{font:15px/1.5 system-ui;background:radial-gradient(circle at top,#172847 0,#0b1220 45%);color:#edf2ff;margin:0;min-height:100vh}
header{padding:24px max(5%,calc((100% - 1120px)/2));background:#101b2fdd;border-bottom:1px solid #26354e;position:sticky;top:0;backdrop-filter:blur(12px);z-index:2}h1{margin:0;font-size:26px;letter-spacing:.2px}
main{max-width:1120px;margin:26px auto;padding:0 16px 36px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))}
.card{background:linear-gradient(145deg,#14213a,#101a2c);border:1px solid #2a3b58;border-radius:18px;padding:20px;min-width:0;box-shadow:0 10px 35px #0002}
h2{font-size:18px;margin:0 0 12px}.muted{color:#9eacc6}.pill{display:inline-block;padding:6px 12px;border-radius:20px;background:#233653;font-weight:700}
button,input{font:inherit;border-radius:10px;padding:11px 13px;border:1px solid #3a4c69;background:#0b1220;color:#fff}
button{cursor:pointer;background:#2365d8;border:0;margin:5px 4px 5px 0;transition:filter .15s,transform .15s}button:hover{filter:brightness(1.15);transform:translateY(-1px)}button:disabled{opacity:.5;cursor:wait}.danger{background:#a62f42}.secondary{background:#33445f}
input{width:100%;margin:6px 0 10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0b1220;padding:12px;border-radius:8px}
#qr{width:250px;max-width:100%;background:white;padding:8px;border-radius:8px;display:none}.log{font:12px/1.5 ui-monospace,monospace;padding:8px 0;border-bottom:1px solid #26354e;overflow-wrap:anywhere}
a{color:#9ec5ff}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.small{font-size:12px}.warning{border-color:#8b3445}.statusline{display:flex;justify-content:space-between;gap:12px;align-items:center}.statusdot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#e2a13a;margin-right:7px}
</style></head><body>
<header><h1>👑 ${escapeHtml(config.botName)}</h1><div class="muted">Official WhatsApp Bot · Secure Dashboard · by ${escapeHtml(config.author)}</div></header>
<main>
<section class="card"><h2>⚡ Connection Status</h2><div id="status" class="pill">Loading…</div><p class="muted" id="details">Fetching status</p>
<div class="row"><button onclick="refreshAll()">Refresh</button><a href="/health" target="_blank">Health endpoint</a></div>
<p class="small muted">Pairing codes and QR images are sensitive. Do not share them.</p><hr style="border-color:#26354e;margin:16px 0"><h2>Linked account</h2><div id="identity" class="muted">Account details are not available until connected.</div></section>
<section class="card warning"><h2>🔐 Session Controls</h2><p class="muted">Use these controls when the saved WhatsApp session is invalid or you want to link a different account.</p><div class="row"><button class="danger" onclick="logoutWhatsApp()">Log out WhatsApp</button><button class="secondary" onclick="deleteSession()">Delete saved session</button></div><p class="small muted" id="sessionMsg">Logout attempts to unlink the WhatsApp session. Delete session clears saved credentials and asks for a new QR/pairing login.</p></section>
<section class="card"><h2>📱 QR Login</h2><p class="muted">Open WhatsApp → Linked Devices → Link a Device, then scan.</p>
<img id="qr" alt="WhatsApp login QR"><p id="qrMsg" class="muted">Waiting for QR…</p><button onclick="refreshQR()">Refresh QR</button></section>
<section class="card"><h2>🔢 Pairing Code Login</h2>
<p class="muted">Use the <b>same number</b> that is logged in on your phone. Bangladesh example: <code>8801XXXXXXXXX</code> (no + or leading 0).</p>
<p class="small muted">If pairing fails with "Couldn't link device", delete saved session, wait 30 seconds, then use <b>QR Login</b> instead (more reliable).</p>
<form id="pairForm"><label for="phone">Phone number (country code + number, digits only)</label>
<input id="phone" placeholder="8801XXXXXXXXX" autocomplete="off" required minlength="10" maxlength="15">
<button type="submit">Generate Pairing Code</button></form>
<pre id="pairCode">No pairing code requested</pre>
<p class="small muted" id="pairMsg"></p></section>
<section class="card"><h2>🤖 AI Control Center</h2><p class="muted">Persistent AI settings stored in MongoDB.</p><div id="aiSettings">Loading…</div><div class="row"><button onclick="setAI('autoChat',true)">Auto Chat ON</button><button class="secondary" onclick="setAI('autoChat',false)">Auto Chat OFF</button></div><div class="row"><button onclick="setAI('group',true)">Group ON</button><button class="secondary" onclick="setAI('group',false)">Group OFF</button><button onclick="setAI('inbox',true)">Inbox ON</button><button class="secondary" onclick="setAI('inbox',false)">Inbox OFF</button></div><div class="row"><button onclick="setAI('memory',true)">Memory ON</button><button class="secondary" onclick="setAI('memory',false)">Memory OFF</button></div><p class="small muted" id="aiMsg"></p></section>
<section class="card"><h2>🧠 Learning Control</h2><p class="muted">Consent-based learning. Users must opt in themselves before their ordinary messages are retained.</p><div id="learningStatus">Loading…</div><div class="row"><button onclick="setLearning(true)">Learning ON</button><button class="danger" onclick="setLearning(false)">Learning OFF</button></div><p id="learningMsg" class="small muted"></p></section>
<section class="card"><h2>🧩 Plugin Manager</h2><p class="muted">Plugin state is stored in MongoDB and restored after restart.</p><div id="plugins">Loading…</div></section>
<section class="card"><h2>🖥️ System</h2><div id="system" class="muted">Loading…</div></section>
<section class="card"><h2>📋 Recent Logs</h2><div id="logs">Loading…</div></section>
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
  document.getElementById('identity').textContent=d.identity ? ('Name: '+(d.identity.name||'Not provided')+' · Number/ID: '+(d.identity.id||'Not available')) : 'Account details are not available until connected.';
  document.getElementById('system').textContent='Node '+d.node+' · Memory '+d.state.memoryMB+' MB · Host '+d.hostname;
  document.getElementById('plugins').innerHTML=d.plugins.map(p=>'<div class="row" style="align-items:center;justify-content:space-between;margin:8px 0"><span>'+p.name+'</span><button onclick="togglePlugin(&quot;'+p.key+'&quot;,'+(!p.enabled)+')">'+(p.enabled?'Disable':'Enable')+'</button></div>').join('')||'No plugins loaded';
  refreshAI(); refreshLearning();
  document.getElementById('logs').innerHTML=d.logs.map(l=>'<div class="log">['+l.time+'] ['+l.level.toUpperCase()+'] '+l.message.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</div>').join('')||'No logs';
 }catch(e){document.getElementById('details').textContent=e.message}
}
async function refreshAI(){try{const d=await api('/api/ai/settings');document.getElementById('aiSettings').textContent='Auto Chat: '+(d.settings.autoChat?'ON':'OFF')+' · Group: '+(d.settings.group?'ON':'OFF')+' · Inbox: '+(d.settings.inbox?'ON':'OFF')+' · Memory: '+(d.settings.memory?'ON':'OFF')}catch(e){document.getElementById('aiSettings').textContent=e.message}}
async function setAI(key,enabled){const box=document.getElementById('aiMsg');box.textContent='Saving…';try{await api('/api/ai/settings',{method:'POST',body:JSON.stringify({key,enabled})});box.textContent='Saved to MongoDB';refreshAI()}catch(e){box.textContent=e.message}}
async function refreshLearning(){try{const d=await api('/api/learning/settings');document.getElementById('learningStatus').textContent='Global learning: '+(d.enabled?'ON':'OFF')+' · Stored entries: '+d.entries+' · Opt-in users: '+d.optedIn}catch(e){document.getElementById('learningStatus').textContent=e.message}}
async function setLearning(enabled){const box=document.getElementById('learningMsg');box.textContent='Saving…';try{await api('/api/learning/settings',{method:'POST',body:JSON.stringify({enabled})});box.textContent='Saved to MongoDB';refreshLearning()}catch(e){box.textContent=e.message}}
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
async function logoutWhatsApp(){if(!confirm('Log out this WhatsApp account and clear the saved session? You will need to link it again.'))return;const box=document.getElementById('sessionMsg');box.textContent='Logging out…';try{await api('/api/session/logout',{method:'POST'});box.textContent='Logged out. New QR/pairing login is being prepared.';setTimeout(refreshQR,1500);refreshAll()}catch(e){box.textContent=e.message}}
async function deleteSession(){if(!confirm('Delete saved WhatsApp session credentials? This cannot be undone; a new QR/pairing login will be required.'))return;const box=document.getElementById('sessionMsg');box.textContent='Deleting saved session…';try{await api('/api/session/delete',{method:'POST'});box.textContent='Saved session deleted. New QR/pairing login is being prepared.';setTimeout(refreshQR,1500);refreshAll()}catch(e){box.textContent=e.message}}
refreshAll();refreshQR();setInterval(refreshAll,5000);setInterval(refreshQR,7000);
</script></body></html>`);
  });

  app.get("/api/status", (_req, res) => {
    const plugins = [...pluginModules.entries()].map(([key, plugin]) => ({
      key, name: plugin.name || key, enabled: config.plugins[key] !== false
    }));
    res.json({ state: getBotState(), identity: getBotIdentity?.() || null, plugins, logs: getLogs().slice(0, 50), node: process.version, hostname: os.hostname() });
  });

  app.get("/api/ai/settings", async (_req, res) => {
    try {
      const collection = getMongoSettingsCollection?.();
      if (!collection) return res.status(503).json({ error: "MongoDB settings are not connected" });
      const doc = await collection.findOne({ _id: "ai" });
      res.json({ settings: { autoChat: false, group: false, inbox: true, memory: true, ...(doc?.values || {}) } });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/settings", async (req, res) => {
    try {
      const { key, enabled } = req.body || {};
      if (!["autoChat", "group", "inbox", "memory"].includes(key) || typeof enabled !== "boolean") {
        return res.status(400).json({ error: "Invalid AI setting" });
      }
      const collection = getMongoSettingsCollection?.();
      if (!collection) return res.status(503).json({ error: "MongoDB settings are not connected" });
      const doc = await collection.findOne({ _id: "ai" });
      const values = { autoChat: false, group: false, inbox: true, memory: true, ...(doc?.values || {}), [key]: enabled };
      await collection.updateOne({ _id: "ai" }, { $set: { values, updatedAt: new Date() } }, { upsert: true });
      addLog("success", `Dashboard AI setting changed: ${key}=${enabled}`);
      res.json({ ok: true, settings: values });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/learning/settings", async (_req, res) => {
    try {
      const collection = getMongoSettingsCollection?.();
      if (!collection) return res.status(503).json({ error: "MongoDB settings are not connected" });
      const doc = await collection.findOne({ _id: "learning" });
      const db = getMongoDb?.();
      const entries = db ? await db.collection("learning_entries").countDocuments({}) : 0;
      const optedIn = db ? await db.collection("learning_consent").countDocuments({ enabled: true }) : 0;
      res.json({ enabled: doc?.enabled === true, entries, optedIn });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/learning/settings", async (req, res) => {
    try {
      if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
      const collection = getMongoSettingsCollection?.();
      if (!collection) return res.status(503).json({ error: "MongoDB settings are not connected" });
      await collection.updateOne({ _id: "learning" }, { $set: { enabled: req.body.enabled, updatedAt: new Date() } }, { upsert: true });
      addLog("success", `Dashboard learning feature ${req.body.enabled ? "enabled" : "disabled"}`);
      res.json({ ok: true, enabled: req.body.enabled });
    } catch (error) { res.status(500).json({ error: error.message }); }
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

  app.post("/api/session/logout", async (_req, res) => {
    try {
      await dashboardLogout();
      res.json({ ok: true, message: "WhatsApp logged out; session reset." });
    } catch (error) {
      addLog("error", `Dashboard logout failed: ${error.message}`);
      res.status(500).json({ error: `Logout failed: ${error.message}` });
    }
  });

  app.post("/api/session/delete", async (_req, res) => {
    try {
      await dashboardDeleteSession();
      res.json({ ok: true, message: "Saved session deleted; new login required." });
    } catch (error) {
      addLog("error", `Session deletion failed: ${error.message}`);
      res.status(500).json({ error: `Could not delete saved session: ${error.message}` });
    }
  });

  app.post("/api/plugins/toggle", async (req, res) => {
    const { key, enabled } = req.body || {};
    if (!pluginModules.has(key)) return res.status(404).json({ error: "Plugin not found" });
    try {
      await savePluginSetting(key, Boolean(enabled));
      config.plugins[key] = Boolean(enabled);
      addLog("success", `Plugin ${key} ${config.plugins[key] ? "enabled" : "disabled"}; saved to MongoDB`);
      res.json({ ok: true, key, enabled: config.plugins[key], saved: true });
    } catch (error) {
      addLog("error", `Could not save plugin setting: ${error.message}`);
      res.status(503).json({ error: `Setting not saved. Check MongoDB connection: ${error.message}` });
    }
  });
}
