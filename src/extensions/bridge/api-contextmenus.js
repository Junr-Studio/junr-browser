'use strict';
// chrome.contextMenus : les entrées déclarées par une extension sont mémorisées ici (par client et par extension)
// et ajoutées au menu contextuel des pages ; un clic est renvoyé à l'extension (onClicked), en réveillant son service worker si besoin.
const { matchPattern } = require('./match');
const model = require('./model');

const registry = new Map(); // « client|extension » → Map(id → entrée)
let auto = 0;

const keyOf = (ctx) => `${ctx.spaceId}|${ctx.extId}`;
const itemsOf = (ctx) => registry.get(keyOf(ctx)) || registry.set(keyOf(ctx), new Map()).get(keyOf(ctx));

const TYPES = ['normal', 'checkbox', 'radio', 'separator'];
const CONTEXTS = ['all', 'page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio', 'launcher', 'browser_action', 'page_action', 'action'];

function normalize(props, previous = {}) {
  const e = { ...previous };
  if (props.type !== undefined) { if (!TYPES.includes(props.type)) throw new Error(`Invalid value for argument 1. Property 'type': Value must be one of: [${TYPES.join(', ')}].`); e.type = props.type; }
  if (props.title !== undefined) e.title = String(props.title);
  if (props.checked !== undefined) e.checked = !!props.checked;
  if (props.contexts !== undefined) { e.contexts = [].concat(props.contexts); for (const c of e.contexts) if (!CONTEXTS.includes(c)) throw new Error(`Invalid context: ${c}`); }
  if (props.visible !== undefined) e.visible = !!props.visible;
  if (props.enabled !== undefined) e.enabled = !!props.enabled;
  if (props.parentId !== undefined) e.parentId = props.parentId;
  if (props.documentUrlPatterns !== undefined) e.documentUrlPatterns = props.documentUrlPatterns;
  if (props.targetUrlPatterns !== undefined) e.targetUrlPatterns = props.targetUrlPatterns;
  return e;
}

// Contextes du clic (données de l'événement « context-menu » d'Electron).
function contextsOf(p) {
  const c = new Set(['all']);
  const specific = [];
  if (p.linkURL) specific.push('link');
  if (p.selectionText) specific.push('selection');
  if (p.isEditable) specific.push('editable');
  if (p.mediaType === 'image') specific.push('image');
  if (p.mediaType === 'video') specific.push('video');
  if (p.mediaType === 'audio') specific.push('audio');
  for (const s of specific) c.add(s);
  if (!specific.length) c.add('page');
  if (p.frameURL && p.frameURL !== p.pageURL) c.add('frame');
  return c;
}

function matches(item, ctxs, p) {
  if (item.visible === false) return false;
  if (!(item.contexts || ['page']).some((c) => ctxs.has(c))) return false;
  if (item.documentUrlPatterns?.length && !item.documentUrlPatterns.some((pat) => matchPattern(pat, p.frameURL || p.pageURL))) return false;
  if (item.targetUrlPatterns?.length) {
    const target = p.linkURL || p.srcURL;
    if (!target || !item.targetUrlPatterns.some((pat) => matchPattern(pat, target))) return false;
  }
  return true;
}

function titleFor(item, p) {
  const sel = (p.selectionText || '').slice(0, 50);
  return String(item.title || '').replace(/%s/g, sel) || ' ';
}

// Entrées de menu (options d'Electron.MenuItem) d'une extension pour ce clic, ou [] ; `onClick(info, item)` est appelé au clic.
function menuFor(spaceId, extId, params, ctxs, onClick) {
  const items = registry.get(`${spaceId}|${extId}`);
  if (!items?.size) return [];
  const all = [...items.values()];
  const build = (parentId) => all.filter((i) => (i.parentId ?? null) === (parentId ?? null) && matches(i, ctxs, params)).map((i) => {
    const kids = all.some((k) => k.parentId === i.id) ? build(i.id) : null;
    if (i.type === 'separator') return { type: 'separator' };
    if (kids && kids.length) return { label: titleFor(i, params), enabled: i.enabled !== false, submenu: kids };
    const checkable = i.type === 'checkbox' || i.type === 'radio';
    return { label: titleFor(i, params), enabled: i.enabled !== false, type: checkable ? i.type : 'normal', checked: checkable ? !!i.checked : undefined, click: () => onClick(i) };
  });
  return build(null);
}

// Pour la barre d'extensions : entrées dont le contexte est « action » (clic droit sur l'icône).
function actionMenu(spaceId, extId, onClick) {
  return menuFor(spaceId, extId, {}, new Set(['all', 'action', 'browser_action', 'page_action']), onClick);
}

// Clic sur une entrée : met à jour les cases/radios et prévient l'extension.
function clicked(spaceId, extId, item, params, tab) {
  const items = registry.get(`${spaceId}|${extId}`);
  const live = items?.get(item.id);
  if (!live) return;
  const info = { menuItemId: live.id, editable: !!params.isEditable, pageUrl: params.pageURL || undefined, frameUrl: params.frameURL || undefined };
  if (params.linkURL) info.linkUrl = params.linkURL;
  if (params.srcURL) info.srcUrl = params.srcURL;
  if (params.mediaType && params.mediaType !== 'none') info.mediaType = params.mediaType;
  if (params.selectionText) info.selectionText = params.selectionText;
  if (live.parentId !== undefined) info.parentMenuItemId = live.parentId;
  if (live.type === 'checkbox') { info.wasChecked = !!live.checked; live.checked = !live.checked; info.checked = live.checked; }
  if (live.type === 'radio') {
    info.wasChecked = !!live.checked;
    for (const o of items.values()) if (o.type === 'radio' && o.parentId === live.parentId) o.checked = false;
    live.checked = true; info.checked = true;
  }
  require('./index').emit('contextMenus.onClicked', (ctx) => [info, tab ? model.tabInfo(ctx, tab) : undefined].filter((x) => x !== undefined), { spaceId, extId });
}

// Entrées de toutes les extensions du client pour ce clic dans la page (menu contextuel de l'onglet).
function menusForPage(spaceId, params, tab) {
  const ctxs = contextsOf(params);
  const out = [];
  for (const key of registry.keys()) {
    const [sp, extId] = key.split('|');
    if (sp !== String(spaceId)) continue;
    const entries = menuFor(spaceId, extId, params, ctxs, (item) => clicked(spaceId, extId, item, params, tab));
    if (!entries.length) continue;
    const name = require('./index').manifestOf(extId)?.name || extId;
    out.push(entries.length > 1 ? { label: name, submenu: entries } : entries[0]);
  }
  return out;
}

module.exports = {
  ns: 'contextMenus',
  permission: 'contextMenus',
  constants: { ACTION_MENU_TOP_LEVEL_LIMIT: 6 },
  events: ['onClicked'],
  methods: {
    async create(ctx, props = {}) {
      const items = itemsOf(ctx);
      const id = props.id !== undefined ? props.id : `junr-menu-${++auto}`;
      if (items.has(id)) throw new Error(`Cannot create item with duplicate id ${id}`);
      if (props.parentId !== undefined && !items.has(props.parentId)) throw new Error(`Cannot find menu item with id ${props.parentId}`);
      const entry = normalize(props, { id, type: 'normal', contexts: ['page'], enabled: true, visible: true });
      if ((entry.type !== 'separator') && !entry.title) throw new Error('All menu items except for separators must have a title.');
      items.set(id, entry);
      return id;
    },
    async update(ctx, id, props = {}) {
      const items = itemsOf(ctx);
      const cur = items.get(id);
      if (!cur) throw new Error(`Cannot find menu item with id ${id}`);
      items.set(id, normalize(props, cur));
    },
    async remove(ctx, id) {
      const items = itemsOf(ctx);
      if (!items.delete(id)) throw new Error(`Cannot find menu item with id ${id}`);
      for (const k of [...items.values()]) if (k.parentId === id) items.delete(k.id); // sous-entrées supprimées avec leur parent
    },
    async removeAll(ctx) { itemsOf(ctx).clear(); },
  },
  onExtensionRemoved(extId) { for (const k of [...registry.keys()]) if (k.endsWith('|' + extId)) registry.delete(k); },
  menuFor, actionMenu, contextsOf, clicked, menusForPage,
  _registry: registry,
};
