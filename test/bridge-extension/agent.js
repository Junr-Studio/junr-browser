/* Agent de test : exécute dans le contexte d'une extension (service worker ou page) les appels chrome.* demandés par le test.
 * `__BASE__` est remplacé par l'adresse du serveur de test à la fabrication du CRX. Pas d'eval : les appels sont désignés par leur chemin. */
(function () {
  const BASE = '__BASE__';
  const KIND = typeof window === 'undefined' ? 'sw' : 'page';
  const log = [];
  const startup = [];
  const bootAt = Date.now();
  if (KIND === 'sw') { try { chrome.runtime.onInstalled.addListener((d) => startup.push({ name: 'runtime.onInstalled', details: d })); chrome.runtime.onStartup.addListener(() => startup.push({ name: 'runtime.onStartup' })); } catch { /* absent */ } }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const resolve = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), chrome);

  async function run(cmd) {
    if (cmd.type === 'call') {
      const parts = cmd.path.split('.');
      const fn = resolve(cmd.path);
      if (typeof fn !== 'function') throw new Error('not a function: ' + cmd.path + ' (' + typeof fn + ')');
      return fn.apply(resolve(parts.slice(0, -1).join('.')), cmd.args || []);
    }
    if (cmd.type === 'callback') { // style rappel : renvoie la valeur et runtime.lastError
      return new Promise((ok) => {
        const parts = cmd.path.split('.');
        const fn = resolve(cmd.path);
        fn.apply(resolve(parts.slice(0, -1).join('.')), [...(cmd.args || []), (value) => ok({ value, lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : null })]);
      });
    }
    if (cmd.type === 'listen') {
      const ev = resolve(cmd.name);
      if (!ev || typeof ev.addListener !== 'function') throw new Error('no event ' + cmd.name);
      ev.addListener((...args) => {
        const fn = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
        log.push({ name: cmd.as || cmd.name, args: JSON.parse(JSON.stringify(fn ? args.slice(0, -1) : args)) });
        if (fn && cmd.reply !== undefined) { fn(cmd.reply); return true; }
        return undefined;
      }, ...(cmd.filter ? [cmd.filter] : []));
      return true;
    }
    if (cmd.type === 'startup') return startup.length ? startup.slice() : [];
    if (cmd.type === 'boot') return { bootAt, now: Date.now(), startup: startup.length };
    if (cmd.type === 'events') { const out = log.splice(0, log.length); return out; }
    if (cmd.type === 'prop') return JSON.parse(JSON.stringify(resolve(cmd.path) ?? null));
    if (cmd.type === 'typeof') return typeof resolve(cmd.path);
    if (cmd.type === 'dump') { const o = resolve(cmd.path); return { type: typeof o, hasCreate: 'create' in o, createType: typeof o.create, keys: Reflect.ownKeys(o).filter((k) => typeof k === 'string').slice(0, 60), shimmed: !!globalThis.__junrShimInstalled, specTabs: globalThis.__JUNR_SPEC && Object.keys(globalThis.__JUNR_SPEC.ns).join(',') }; }
    if (cmd.type === 'media') { // getUserMedia / getDisplayMedia depuis la page d'extension : renvoie les pistes obtenues puis les arrête
      const stream = cmd.display ? await navigator.mediaDevices.getDisplayMedia(cmd.constraints) : await navigator.mediaDevices.getUserMedia(cmd.constraints);
      const tracks = stream.getTracks().map((t) => ({ kind: t.kind, label: t.label, readyState: t.readyState }));
      stream.getTracks().forEach((t) => t.stop());
      return tracks;
    }
    if (cmd.type === 'native') { // dialogue complet avec un hôte natif par chrome.runtime.connectNative
      const port = chrome.runtime.connectNative(cmd.host);
      const got = [];
      let disc = null;
      port.onMessage.addListener((m) => got.push(m));
      port.onDisconnect.addListener(() => { disc = chrome.runtime.lastError ? chrome.runtime.lastError.message : ''; });
      for (const m of cmd.send || []) port.postMessage(m);
      await sleep(cmd.waitMs || 1000);
      if (cmd.disconnect) port.disconnect();
      await sleep(150);
      return { got, disc };
    }
    if (cmd.type === 'who') return globalThis.__junr.invoke('$whoami', []);
    throw new Error('unknown command ' + cmd.type);
  }

  async function loop() {
    let who;
    for (let i = 0; i < 50 && !who; i++) { try { who = await globalThis.__junr.invoke('$whoami', []); } catch { await sleep(200); } }
    if (!who) return;
    for (;;) {
      let res;
      try { res = await fetch(`${BASE}/bridge/poll?space=${encodeURIComponent(who.spaceId)}&kind=${KIND}&ext=${who.extId}`); } catch { await sleep(300); continue; }
      if (res.status !== 200) continue;
      const cmd = await res.json();
      let out;
      try { out = { id: cmd.id, ok: true, value: JSON.parse(JSON.stringify((await run(cmd)) ?? null)) }; } catch (e) { out = { id: cmd.id, ok: false, error: String((e && e.message) || e) }; }
      try { await fetch(`${BASE}/bridge/result`, { method: 'POST', body: JSON.stringify(out) }); } catch { /* le test réessaiera */ }
    }
  }
  loop();
})();
