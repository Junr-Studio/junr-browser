'use strict';
// Groupes d'onglets d'un client (« Administratif », « Développement »…). Un groupe filtre la barre du haut :
// il ne ferme ni n'endort rien. Un outil appartient à un groupe de façon durable (`tool.group`), un onglet libre jusqu'à sa fermeture.
const crypto = require('node:crypto');
const { state } = require('./state');

const MAX_GROUPS = 12;
const NONE = '__none'; // vue « sans groupe »

const clientOf = (spaceId) => state.store.data.clients.find((c) => c.id === spaceId) || null;
const listOf = (spaceId) => clientOf(spaceId)?.groups || [];
const exists = (spaceId, id) => listOf(spaceId).some((g) => g.id === id);
const isClientTab = (tab) => !!tab && !tab.internal && tab.spaceId !== 'global' && !!clientOf(tab.spaceId);

function cleanName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!n) throw new Error('Groupe sans nom');
  return n;
}

// Groupe d'un onglet (null : sans groupe, ou onglet hors client).
function groupOf(tab) {
  if (!isClientTab(tab)) return null;
  const id = tab.toolId ? clientOf(tab.spaceId).tools.find((t) => t.id === tab.toolId)?.group : tab.groupId;
  return id && exists(tab.spaceId, id) ? id : null;
}

// Vue courante d'un client : un identifiant de groupe, NONE, ou null (tous les onglets).
function activeOf(spaceId) {
  const a = state.activeGroup[spaceId];
  if (a === NONE) return NONE;
  return a && exists(spaceId, a) ? a : null;
}

// L'onglet est-il visible dans la barre du haut pour la vue courante de son client ?
function inView(tab) {
  if (!isClientTab(tab)) return true;
  const a = activeOf(tab.spaceId);
  if (!a) return true;
  return a === NONE ? groupOf(tab) === null : groupOf(tab) === a;
}

// Groupe réel à donner aux nouveaux onglets libres d'un client (la vue « sans groupe » n'en donne aucun).
const defaultFor = (spaceId) => { const a = activeOf(spaceId); return a && a !== NONE ? a : null; };

function setActive(spaceId, groupId) {
  if (!clientOf(spaceId)) throw new Error('Client inconnu');
  if (groupId && groupId !== NONE && !exists(spaceId, groupId)) throw new Error('Groupe inconnu');
  if (groupId) state.activeGroup[spaceId] = groupId;
  else delete state.activeGroup[spaceId];
}

function add(spaceId, name) {
  const c = clientOf(spaceId);
  if (!c) throw new Error('Client inconnu');
  const n = cleanName(name);
  c.groups ||= [];
  if (c.groups.length >= MAX_GROUPS) throw new Error(`${MAX_GROUPS} groupes au maximum par client`);
  if (c.groups.some((g) => g.name.toLowerCase() === n.toLowerCase())) throw new Error('Ce groupe existe déjà');
  const g = { id: crypto.randomUUID(), name: n };
  c.groups.push(g);
  state.store.save();
  return g;
}

function rename(spaceId, id, name) {
  const g = listOf(spaceId).find((x) => x.id === id);
  if (!g) throw new Error('Groupe inconnu');
  const n = cleanName(name);
  if (listOf(spaceId).some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new Error('Ce groupe existe déjà');
  g.name = n;
  state.store.save();
}

// Les onglets du groupe ne sont pas fermés : ils redeviennent sans groupe.
function remove(spaceId, id) {
  const c = clientOf(spaceId);
  if (!c || !exists(spaceId, id)) throw new Error('Groupe inconnu');
  c.groups = c.groups.filter((g) => g.id !== id);
  for (const t of c.tools) if (t.group === id) delete t.group;
  for (const t of state.tabs.values()) if (t.spaceId === spaceId && t.groupId === id) t.groupId = null;
  if (state.activeGroup[spaceId] === id) delete state.activeGroup[spaceId];
  state.store.save();
}

// Range un onglet dans un groupe (ou le sort de son groupe avec null).
function assign(tabId, groupId) {
  const tab = state.tabs.get(tabId);
  if (!isClientTab(tab)) throw new Error('Cet onglet n\'appartient à aucun client');
  const gid = groupId || null;
  if (gid && !exists(tab.spaceId, gid)) throw new Error('Groupe inconnu');
  if (tab.toolId) {
    const tool = clientOf(tab.spaceId).tools.find((t) => t.id === tab.toolId);
    if (gid) tool.group = gid; else delete tool.group;
    state.store.save();
  } else tab.groupId = gid;
}

// Résumé pour l'interface : effectifs et signaux par groupe, calculés avec les lignes d'outils (`rows`) du client.
function summary(spaceId, rows) {
  const c = clientOf(spaceId);
  const tabs = [...state.tabs.values()].filter((t) => t.spaceId === spaceId && !t.internal);
  const marksOf = (pred) => rows.filter((r) => r.delta > 0 && pred(r)).length;
  const groups = (c?.groups || []).map((g) => ({
    id: g.id, name: g.name, count: tabs.filter((t) => groupOf(t) === g.id).length, marks: marksOf((r) => r.group === g.id),
  }));
  return {
    groups,
    ungrouped: { count: tabs.filter((t) => groupOf(t) === null).length, marks: marksOf((r) => !r.group) },
    group: activeOf(spaceId),
  };
}

module.exports = { MAX_GROUPS, NONE, groupOf, activeOf, inView, defaultFor, setActive, add, rename, remove, assign, summary, listOf, exists };
