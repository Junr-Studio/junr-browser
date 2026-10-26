'use strict';
// chrome.bookmarks : arbre de favoris COMMUN à tous les clients (les favoris communs passent par les fonctions natives
// de l'application, voir le plan), stocké dans le store. Racine « 0 », barre « 1 », autres favoris « 2 ».
const { state } = require('../../state');

let emitFn = null;

function data() {
  const d = state.store.data;
  if (!d.bookmarks) {
    const now = Date.now();
    d.bookmarks = { next: 3, nodes: {
      0: { id: '0', title: '', children: ['1', '2'], dateAdded: now },
      1: { id: '1', parentId: '0', title: 'Barre de favoris', children: [], dateAdded: now, folderType: 'bookmarks-bar' },
      2: { id: '2', parentId: '0', title: 'Autres favoris', children: [], dateAdded: now, folderType: 'other' },
    } };
  }
  return d.bookmarks;
}
const nodes = () => data().nodes;
const isRoot = (id) => ['0', '1', '2'].includes(String(id));

function node(id) {
  const n = nodes()[String(id)];
  if (!n) throw new Error('Can\'t find bookmark for id.');
  return n;
}

function view(n, deep = false) {
  const parent = n.parentId !== undefined ? nodes()[n.parentId] : null;
  const o = { id: n.id, title: n.title, dateAdded: n.dateAdded };
  if (n.parentId !== undefined) { o.parentId = n.parentId; o.index = parent.children.indexOf(n.id); }
  if (n.url !== undefined) o.url = n.url;
  if (n.children) { o.dateGroupModified = n.dateGroupModified || n.dateAdded; if (n.folderType) o.folderType = n.folderType; if (isRoot(n.id)) o.syncing = false; if (deep) o.children = n.children.map((c) => view(nodes()[c], true)); }
  if (isRoot(n.id)) o.unmodifiable = 'managed';
  return JSON.parse(JSON.stringify(o));
}

function save() { state.store.save(); }
const emit = (name, args) => emitFn?.(`bookmarks.${name}`, args);

function insert(parentId, n, index) {
  const parent = node(parentId);
  if (!parent.children) throw new Error('Parent folder not found.');
  const i = index === undefined || index > parent.children.length ? parent.children.length : Math.max(0, index);
  parent.children.splice(i, 0, n.id);
  n.parentId = parent.id;
  parent.dateGroupModified = Date.now();
}

function detach(n) {
  const parent = nodes()[n.parentId];
  const i = parent.children.indexOf(n.id);
  parent.children.splice(i, 1);
  return { parentId: parent.id, index: i };
}

function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Invalid URL.'); }
  if (/^javascript:$/i.test(u.protocol)) throw new Error('Invalid URL.');
  return u.href;
}

function descendants(n, out = []) {
  for (const c of n.children || []) { out.push(nodes()[c]); descendants(nodes()[c], out); }
  return out;
}

function matchQuery(n, q) {
  if (typeof q === 'string') { const t = q.toLowerCase().split(/\s+/).filter(Boolean); return t.every((w) => (n.title || '').toLowerCase().includes(w) || (n.url || '').toLowerCase().includes(w)); }
  if (q.url !== undefined && n.url !== q.url) return false;
  if (q.title !== undefined && n.title !== q.title) return false;
  if (q.query !== undefined && !matchQuery(n, q.query)) return false;
  return true;
}

module.exports = {
  ns: 'bookmarks',
  permission: 'bookmarks',
  constants: { MAX_WRITE_OPERATIONS_PER_HOUR: 1000000, MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE: 1000000 },
  events: ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportBegan', 'onImportEnded'],
  methods: {
    async getTree() { return [view(node('0'), true)]; },
    async getSubTree(ctx, id) { return [view(node(id), true)]; },
    async get(ctx, ids) { return [].concat(ids).map((id) => view(node(id))); },
    async getChildren(ctx, id) { return (node(id).children || []).map((c) => view(nodes()[c])); },
    async getRecent(ctx, n) {
      return Object.values(nodes()).filter((x) => x.url !== undefined).sort((a, b) => b.dateAdded - a.dateAdded).slice(0, n).map((x) => view(x));
    },
    async search(ctx, q) { return Object.values(nodes()).filter((x) => x.id !== '0' && matchQuery(x, q)).map((x) => view(x)); },
    async create(ctx, b = {}) {
      const d = data();
      const id = String(d.next++);
      const n = { id, title: String(b.title ?? ''), dateAdded: Date.now() };
      if (b.url !== undefined) n.url = checkUrl(b.url); else n.children = [];
      insert(b.parentId === undefined ? '2' : b.parentId, n, b.index);
      d.nodes[id] = n;
      save();
      emit('onCreated', [id, view(n)]);
      return view(n);
    },
    async move(ctx, id, dest = {}) {
      const n = node(id);
      if (isRoot(id)) throw new Error('Can\'t modify the root bookmark folders.');
      const target = dest.parentId === undefined ? n.parentId : String(dest.parentId);
      if (n.children && (target === n.id || descendants(n).some((x) => x.id === target))) throw new Error('Can\'t move a folder to itself or its descendant.');
      const old = detach(n);
      insert(target, n, dest.index);
      save();
      const now = view(n);
      emit('onMoved', [n.id, { parentId: now.parentId, index: now.index, oldParentId: old.parentId, oldIndex: old.index }]);
      return now;
    },
    async update(ctx, id, ch = {}) {
      const n = node(id);
      if (isRoot(id)) throw new Error('Can\'t modify the root bookmark folders.');
      const changes = {};
      if (ch.title !== undefined) { n.title = String(ch.title); changes.title = n.title; }
      if (ch.url !== undefined) { if (n.children) throw new Error('Can\'t set URL of a bookmark folder.'); n.url = checkUrl(ch.url); changes.url = n.url; }
      save();
      emit('onChanged', [n.id, changes]);
      return view(n);
    },
    async remove(ctx, id) {
      const n = node(id);
      if (isRoot(id)) throw new Error('Can\'t modify the root bookmark folders.');
      if (n.children?.length) throw new Error('Can\'t remove non-empty folder (use recursive removal instead).');
      const v = view(n);
      const where = detach(n);
      delete nodes()[n.id];
      save();
      emit('onRemoved', [n.id, { ...where, node: v }]);
    },
    async removeTree(ctx, id) {
      const n = node(id);
      if (isRoot(id)) throw new Error('Can\'t modify the root bookmark folders.');
      const v = view(n, true);
      const where = detach(n);
      for (const x of descendants(n)) delete nodes()[x.id];
      delete nodes()[n.id];
      save();
      emit('onRemoved', [n.id, { ...where, node: v }]);
    },
  },
  install({ emit: e }) { emitFn = e; },
};
