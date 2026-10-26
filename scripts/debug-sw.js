'use strict';
// Diagnostic : lance l'application avec le protocole DevTools, s'attache au service worker d'une extension DÈS SON DÉMARRAGE et
// affiche la pile et le code autour de chaque exception qui correspond à un motif (par défaut « is not a function » et
// « Cannot destructure »). Utile pour savoir quelle API chrome.* manque à une extension minifiée.
//   EXT_ID=<id> [PATTERN="regex"] [WAIT_MS=15000] node scripts/debug-sw.js
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const extId = process.env.EXT_ID;
if (!extId) { console.error('EXT_ID requis'); process.exit(2); }
const pattern = new RegExp(process.env.PATTERN || 'is not a function|Cannot destructure|is not defined|undefined', 'i');
const port = 9300 + Math.floor(Math.random() * 500);
const root = path.join(__dirname, '..');

const env0 = { ...process.env };
delete env0.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
  cwd: root, stdio: ['ignore', 'ignore', 'ignore'],
  env: { ...env0, JUNR_SCRIPT: path.join(__dirname, 'spike-ext.js'), EXT_ID: extId, WAIT_MS: process.env.WAIT_MS || '15000' },
});
const stop = () => { try { child.kill(); } catch { /* terminé */ } };
process.on('exit', stop);
child.on('exit', () => setTimeout(() => process.exit(0), 200));

async function main() {
  let info;
  for (let i = 0; i < 100 && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!info) throw new Error('DevTools injoignable');
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const seen = new Set();
  const sources = new Map();

  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (process.env.DEBUG_CDP) console.log('[cdp]', m.method || ('réponse ' + m.id), JSON.stringify(m.params?.targetInfo || m.result || m.error || '').slice(0, 160));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); return; }
    if (m.method === 'Target.attachedToTarget') {
      const t = m.params.targetInfo, sid = m.params.sessionId;
      if (t.type === 'service_worker' && t.url.includes(extId)) {
        console.log(`[cible] service worker ${t.url}`);
        await send('Runtime.enable', {}, sid);
        await send('Debugger.enable', {}, sid);
        await send('Debugger.setPauseOnExceptions', { state: 'all' }, sid);
      }
      await send('Runtime.runIfWaitingForDebugger', {}, sid);
      return;
    }
    if (m.method === 'Debugger.paused' && m.sessionId) {
      const p = m.params;
      const desc = p.data?.description || p.data?.value || p.reason;
      const frames = p.callFrames || [];
      if (pattern.test(String(desc))) {
        const key = `${desc}|${frames[0]?.url}:${frames[0]?.location.lineNumber}:${frames[0]?.location.columnNumber}`;
        if (!seen.has(key) && seen.size < 12) {
          seen.add(key);
          console.log(`\n[exception] ${String(desc).split('\n')[0]}`);
          for (const f of frames.slice(0, 5)) {
            console.log(`   ${f.functionName || '(anonyme)'}  ${f.url.replace(/^chrome-extension:\/\/\w+/, '')}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`);
          }
          if (process.env.EVAL && frames[0]) { const r = await send('Debugger.evaluateOnCallFrame', { callFrameId: frames[0].callFrameId, expression: process.env.EVAL, returnByValue: true }, m.sessionId); console.log('   eval :', JSON.stringify(r.result?.value ?? r.result?.description ?? r.exceptionDetails?.text).slice(0, 400)); }
          const top = frames.find((f) => !f.url.includes('junr-shim')) || frames[0];
          if (top) {
            if (!sources.has(top.location.scriptId)) sources.set(top.location.scriptId, (await send('Debugger.getScriptSource', { scriptId: top.location.scriptId }, m.sessionId)).scriptSource || '');
            const lines = sources.get(top.location.scriptId).split('\n');
            const line = lines[top.location.lineNumber] || '';
            const c = top.location.columnNumber;
            console.log(`   code : …${line.slice(Math.max(0, c - 160), c)}«ICI»${line.slice(c, c + 120)}…`);
          }
        }
      }
      send('Debugger.resume', {}, m.sessionId);
    }
  };
  ws.onopen = async () => {
    await send('Target.setDiscoverTargets', { discover: true });
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  };
}

main().catch((e) => { console.error(e.message); stop(); process.exit(1); });
