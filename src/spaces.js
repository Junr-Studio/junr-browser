'use strict';
// Gestion des clients et de leurs outils depuis l'interface (persistée dans le store, sans toucher config.json).
const crypto = require('node:crypto');
const { state } = require('./state');
const tabs = require('./tabs');
const sessions = require('./sessions');
const permissions = require('./permissions');

const data = () => state.store.data;
const COLORS = ['#d9534f', '#2f8f83', '#5b6fd6', '#c78a1b', '#8e5bd6', '#2a8fbd', '#c2569a', '#6b8f2f'];

function cleanName(name, what) {
  const n = String(name ?? '').trim();
  if (!n) throw new Error(`${what} sans nom`);
  return n.slice(0, 60);
}

function cleanUrl(url) {
  const u = String(url ?? '').trim();
  if (u.startsWith('{diag}')) return u;
  let parsed;
  try { parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`); } catch { throw new Error('Adresse invalide'); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Seules les adresses http(s) sont acceptées');
  return parsed.href;
}

const cleanControl = (url) => (url && String(url).trim() ? cleanUrl(url) : '');

// Garantit que chaque outil a un identifiant stable (le store de la v0.1 n'en avait pas).
function ensureToolIds() {
  for (const owner of [...data().clients, { tools: data().globalTools }]) for (const t of owner.tools) t.id ||= crypto.randomUUID();
  state.store.save();
}

const findClient = (id) => {
  const c = data().clients.find((x) => x.id === id);
  if (!c) throw new Error('Client inconnu');
  return c;
};
const toolsOf = (spaceId) => (spaceId === 'global' ? data().globalTools : findClient(spaceId).tools);

function openToolTab(spaceId, tool) {
  return tabs.addTab({ spaceId, url: tool.url, title: tool.name, toolId: tool.id });
}

function openAllTools() {
  ensureToolIds();
  for (const c of data().clients) for (const t of c.tools) openToolTab(c.id, t);
  for (const t of data().globalTools) openToolTab('global', t);
}

/* ---------- Clients ---------- */
function addClient({ name, color }) {
  const n = cleanName(name, 'Client');
  const client = { id: state.store.uniqueClientId(n), name: n, color: color || COLORS[data().clients.length % COLORS.length], tools: [] };
  data().clients.push(client);
  state.store.save();
  tabs.push();
  return client;
}

function renameClient(id, name, color, critical) {
  const c = findClient(id);
  c.name = cleanName(name, 'Client');
  if (color) c.color = color;
  if (critical !== undefined) c.critical = !!critical;
  state.store.save();
  tabs.layout(); // l'épaisseur du cadre dépend de « sensible »
  tabs.push();
}

async function deleteClient(id) {
  findClient(id);
  for (const t of tabs.tabsOfSpace(id)) await tabs.closeTab(t.id);
  data().clients = data().clients.filter((c) => c.id !== id);
  delete state.lastTabBySpace[id];
  permissions.removeSpace(id);
  require('./extensions/bridge/api-history').clearSpace(id);
  state.store.save();
  await sessions.destroySession(id); // cookies, stockage et cache du client effacés
  if (state.activeSpace === id) {
    const next = data().clients[0]?.id ?? null;
    if (next) await tabs.switchSpace(next);
    else { state.activeSpace = null; state.activeTab = null; tabs.push(); }
  } else tabs.push();
}

function moveClient(id, delta) {
  const list = data().clients;
  const i = list.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  state.store.save();
  tabs.push();
}

/* ---------- Outils ---------- */
function addTool(spaceId, { name, url, controlUrl }) {
  const list = toolsOf(spaceId);
  const tool = { id: crypto.randomUUID(), name: cleanName(name, 'Outil'), url: cleanUrl(url), controlUrl: cleanControl(controlUrl) };
  list.push(tool);
  state.store.save();
  openToolTab(spaceId, tool);
  tabs.push();
  return tool;
}

function updateTool(spaceId, toolId, { name, url, controlUrl, keepAwake, family }) {
  const tool = toolsOf(spaceId).find((t) => t.id === toolId);
  if (!tool) throw new Error('Outil inconnu');
  if (name !== undefined) tool.name = cleanName(name, 'Outil');
  if (url !== undefined) tool.url = cleanUrl(url);
  if (controlUrl !== undefined) tool.controlUrl = cleanControl(controlUrl);
  if (keepAwake !== undefined) tool.keepAwake = !!keepAwake;
  if (family !== undefined) tool.family = String(family).trim().slice(0, 30);
  state.store.save();
  for (const t of state.tabs.values()) {
    if (t.toolId !== toolId) continue;
    t.title = tool.name;
    if (!t.view) t.url = tabs.resolveUrl(tool.url);
  }
  tabs.push();
}

async function deleteTool(spaceId, toolId) {
  const list = toolsOf(spaceId);
  const i = list.findIndex((t) => t.id === toolId);
  if (i < 0) throw new Error('Outil inconnu');
  list.splice(i, 1);
  state.store.save();
  for (const t of [...state.tabs.values()]) if (t.toolId === toolId) await tabs.closeTab(t.id);
  tabs.push();
}

// Extensions épinglées dans la barre : les autres ne se montrent que dans le volet « extensions ».
function pinExtension(id, pinned) {
  const s = data().settings;
  const list = new Set(Array.isArray(s.pinnedExtensions) ? s.pinnedExtensions : []);
  if (pinned) list.add(id); else list.delete(id);
  s.pinnedExtensions = [...list];
  state.store.save();
  tabs.push();
}

function setSettings(patch) {
  const s = data().settings;
  if (patch.unloadAfterMs !== undefined) {
    const v = Number(patch.unloadAfterMs);
    if (!Number.isFinite(v) || v < 10000) throw new Error('Délai de veille : 10 s minimum');
    s.unloadAfterMs = Math.round(v);
  }
  if (patch.memThresholdMb !== undefined) {
    const v = Number(patch.memThresholdMb);
    if (!Number.isFinite(v) || v < 0) throw new Error('Seuil de RAM invalide');
    s.memThresholdMb = Math.round(v);
  }
  if (patch.sleepExclusions !== undefined) s.sleepExclusions = [...new Set(patch.sleepExclusions.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  if (patch.protectDrafts !== undefined) s.protectDrafts = !!patch.protectDrafts;
  if (patch.recordHistory !== undefined) s.recordHistory = !!patch.recordHistory;
  if (patch.extensionShims !== undefined) s.extensionShims = !!patch.extensionShims; // appliqué au prochain chargement des extensions
  if (patch.userName !== undefined) s.userName = String(patch.userName).trim().slice(0, 80);
  state.store.save();
  tabs.push();
}

module.exports = {
  openAllTools, ensureToolIds, addClient, renameClient, deleteClient, moveClient, addTool, updateTool, deleteTool, setSettings,
  openToolTab, cleanUrl, pinExtension,
};
