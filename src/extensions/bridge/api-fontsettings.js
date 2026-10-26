'use strict';
// chrome.fontSettings : liste des polices installées (registre sous Windows, fc-list sous Linux, dossiers de polices sous macOS)
// et réglages de police mémorisés par extension (sans effet sur le rendu des pages).
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

let cache = null;

function systemFonts() {
  if (cache) return cache;
  let names = [];
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'], { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 8 << 20 });
      for (const line of out.split(/\r?\n/)) {
        const m = /^\s+(.+?)\s+REG_SZ\s+/.exec(line);
        if (m) for (const part of m[1].replace(/\s*\((TrueType|OpenType|Type 1|All res)\)\s*$/i, '').split(' & ')) names.push(part.trim());
      }
    } else if (process.platform === 'linux') {
      names = execFileSync('fc-list', [':', 'family'], { encoding: 'utf8', timeout: 8000, maxBuffer: 8 << 20 }).split('\n').flatMap((l) => l.split(',')).map((s) => s.trim());
    } else {
      for (const dir of ['/System/Library/Fonts', '/Library/Fonts']) { try { names.push(...fs.readdirSync(dir).map((f) => f.replace(/\.[a-z]+$/i, ''))); } catch { /* dossier absent */ } }
    }
  } catch { /* énumération impossible : liste vide */ }
  cache = [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((n) => ({ fontId: n, displayName: n }));
  return cache;
}

const settings = new Map(); // « client|extension|réglage » → valeur
const key = (ctx, name) => `${ctx.spaceId}|${ctx.extId}|${name}`;
const DEFAULT_SIZES = { DefaultFontSize: 16, DefaultFixedFontSize: 13, MinimumFontSize: 0 };

module.exports = {
  ns: 'fontSettings',
  permission: 'fontSettings',
  events: ['onFontChanged', 'onDefaultFontSizeChanged', 'onDefaultFixedFontSizeChanged', 'onMinimumFontSizeChanged'],
  methods: {
    async getFontList() { return systemFonts(); },
    async getFont(ctx, d = {}) { return { fontId: settings.get(key(ctx, `font:${d.genericFamily}:${d.script || ''}`)) || '', levelOfControl: 'controllable_by_this_extension' }; },
    async setFont(ctx, d = {}) { settings.set(key(ctx, `font:${d.genericFamily}:${d.script || ''}`), String(d.fontId || '')); },
    async clearFont(ctx, d = {}) { settings.delete(key(ctx, `font:${d.genericFamily}:${d.script || ''}`)); },
    ...Object.fromEntries(Object.entries(DEFAULT_SIZES).flatMap(([n, def]) => [
      [`get${n}`, async (ctx) => ({ pixelSize: settings.get(key(ctx, n)) ?? def, levelOfControl: 'controllable_by_this_extension' })],
      [`set${n}`, async (ctx, d = {}) => { settings.set(key(ctx, n), Number(d.pixelSize)); }],
      [`clear${n}`, async (ctx) => { settings.delete(key(ctx, n)); }],
    ])),
  },
  onExtensionRemoved(extId) { for (const k of [...settings.keys()]) if (k.split('|')[1] === extId) settings.delete(k); },
  _systemFonts: systemFonts,
};
