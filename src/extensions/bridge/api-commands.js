'use strict';
// chrome.commands : raccourcis clavier déclarés dans le manifeste (clé « commands »). Les touches sont interceptées sur
// les vues de l'application (avant les pages) ; une correspondance déclenche onCommand dans l'extension du client affiché.
const { state } = require('../../state');
const model = require('./model');

const PLATFORM_KEY = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform] || 'default';

// "Ctrl+Shift+Y" → { ctrl, shift, alt, meta, key }
function parse(shortcut) {
  if (!shortcut) return null;
  const mods = { ctrl: false, shift: false, alt: false, meta: false };
  let key = null;
  for (const part of String(shortcut).split('+').map((s) => s.trim())) {
    const p = part.toLowerCase();
    if (p === 'ctrl') mods.ctrl = true;
    else if (p === 'macctrl') { if (process.platform === 'darwin') mods.ctrl = true; else mods.ctrl = true; }
    else if (p === 'command') { if (process.platform === 'darwin') mods.meta = true; else mods.ctrl = true; }
    else if (p === 'alt' || p === 'option') mods.alt = true;
    else if (p === 'shift') mods.shift = true;
    else key = part;
  }
  if (!key) return null;
  const NAMED = { comma: ',', period: '.', space: ' ', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', pageup: 'pageup', pagedown: 'pagedown', home: 'home', end: 'end', insert: 'insert', delete: 'delete', tab: 'tab' };
  return { ...mods, key: NAMED[key.toLowerCase()] || key.toLowerCase() };
}

function matches(spec, input) {
  return !!spec && !!input.control === spec.ctrl && !!input.shift === spec.shift && !!input.alt === spec.alt && !!input.meta === spec.meta
    && String(input.key).toLowerCase() === spec.key;
}

function commandsOf(manifest) {
  const out = [];
  for (const [name, def] of Object.entries(manifest.commands || {})) {
    const sk = def.suggested_key || {};
    const shortcut = sk[PLATFORM_KEY] || sk.default || '';
    out.push({ name, description: def.description || (name.startsWith('_execute') ? 'Activer l\'extension' : ''), shortcut });
  }
  return out;
}

// Appelé par l'application pour chaque touche pressée dans une vue : renvoie true si un raccourci d'extension l'a prise.
function handleKey(input, tab) {
  if (!tab || input.type !== 'keyDown' || !(input.control || input.alt || input.meta || /^F\d+$/.test(input.key))) return false;
  const manager = require('../manager');
  const bridge = require('./index');
  const entry = state.sessions.get(tab.spaceId);
  if (!entry) return false;
  for (const id of entry.loaded.keys()) {
    const m = bridge.manifestOf(id);
    if (!m) continue;
    for (const c of commandsOf(m.manifest)) {
      if (!matches(parse(c.shortcut), input)) continue;
      if (c.name === '_execute_action' || c.name === '_execute_browser_action' || c.name === '_execute_page_action') {
        require('../actions').click(id, tab.spaceId);
      } else {
        bridge.emit('commands.onCommand', (ctx) => [c.name, model.tabInfo(ctx, tab)].filter((x) => x), { spaceId: tab.spaceId, extId: id });
      }
      void manager;
      return true;
    }
  }
  return false;
}

module.exports = {
  ns: 'commands',
  permission: null,
  events: ['onCommand', 'onChanged'],
  methods: {
    async getAll(ctx) { return commandsOf(ctx.manifest); },
  },
  handleKey, parse, matches, commandsOf,
};
