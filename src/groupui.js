'use strict';
// Gestes des groupes d'onglets côté interface : création, renommage, suppression, menus du clic droit.
const { Menu } = require('electron');
const { state } = require('./state');
const dialog = require('./dialog');
const groups = require('./groups');
const identity = require('./identity');

const tabs = () => require('./tabs');

async function askName({ title, initial = '', hint }) {
  const r = await dialog.show({
    kind: 'prompt', title, placeholder: 'Ex. Administratif, Développement…', initial, enter: 'save', ctrlEnter: 'save',
    hint: hint || 'Entrée : enregistrer · Échap : annuler',
    buttons: [{ id: 'cancel', label: 'Annuler' }, { id: 'save', label: 'Enregistrer ↵', style: 'primary' }],
  });
  return r && r.button === 'save' ? String(r.text || '') : null;
}

function fail(e) { tabs().notify(e.message); }

// Nouveau groupe. `tabId` : l'onglet qui y entre tout de suite (clic droit sur un onglet) ; sinon le groupe naît vide, la vue reste sur « tous ».
async function create(spaceId, tabId = null) {
  const client = identity.clientOf(spaceId);
  if (!client) return null;
  const name = await askName({
    title: `Nouveau groupe chez ${client.name}`,
    hint: tabId ? 'Cet onglet y entre tout de suite · Entrée : créer · Échap : annuler' : 'Le groupe naît vide : clic droit sur un onglet pour le ranger ici · Entrée : créer',
  });
  if (name === null) return null;
  try {
    const g = groups.add(spaceId, name);
    if (tabId) groups.assign(tabId, g.id);
    tabs().notify(tabId ? `Groupe « ${g.name} » créé.` : `Groupe « ${g.name} » créé : clic droit sur un onglet pour l'y ranger.`);
    if (tabId) await tabs().selectGroup(spaceId, g.id); else tabs().pushNow();
    return g;
  } catch (e) { fail(e); return null; }
}

async function rename(spaceId, id) {
  const g = groups.listOf(spaceId).find((x) => x.id === id);
  if (!g) return;
  const name = await askName({ title: 'Renommer le groupe', initial: g.name });
  if (name === null) return;
  try { groups.rename(spaceId, id, name); tabs().pushNow(); } catch (e) { fail(e); }
}

async function remove(spaceId, id) {
  const g = groups.listOf(spaceId).find((x) => x.id === id);
  if (!g) return;
  const answer = await dialog.show({
    kind: 'confirm', title: `Supprimer le groupe « ${g.name} » ?`,
    message: 'Aucun onglet n\'est fermé : ils redeviennent simplement sans groupe.',
    buttons: [{ id: 'cancel', label: 'Annuler' }, { id: 'delete', label: 'Supprimer le groupe', style: 'danger' }],
  });
  if (answer !== 'delete') return;
  const wasShown = groups.activeOf(spaceId) === id;
  groups.remove(spaceId, id);
  // Le groupe affiché disparaît : on retombe sur « Tous » et on y reprend un onglet (une vue vide n'a plus de raison d'être).
  if (wasShown && state.activeSpace === spaceId && !state.tabs.has(state.activeTab)) await tabs().selectGroup(spaceId, null);
  else tabs().pushNow();
}

function assign(tabId, groupId) {
  try {
    groups.assign(Number(tabId), groupId || null);
    const tab = state.tabs.get(Number(tabId));
    // Un onglet déplacé hors de la vue courante : on suit l'onglet quand c'est lui qu'on regarde.
    if (tab && tab.id === state.activeTab && !groups.inView(tab)) groups.setActive(tab.spaceId, groups.groupOf(tab));
    tabs().pushNow();
  } catch (e) { fail(e); }
}

const popup = (template) => Menu.buildFromTemplate(template).popup({ window: state.win });

function groupMenu(spaceId, id) {
  popup([
    { label: 'Renommer le groupe…', click: () => rename(spaceId, id) },
    { label: 'Supprimer le groupe…', click: () => remove(spaceId, id) },
  ]);
}

function tabMenu(tabId) {
  const tab = state.tabs.get(Number(tabId));
  if (!tab) return;
  const t = [];
  if (groups.listOf(tab.spaceId).length || (!tab.internal && tab.spaceId !== 'global')) {
    const current = groups.groupOf(tab);
    for (const g of groups.listOf(tab.spaceId)) t.push({ label: g.name.replaceAll('&', '&&'), type: 'radio', checked: g.id === current, click: () => assign(tab.id, g.id) });
    if (current) t.push({ label: 'Sans groupe', click: () => assign(tab.id, null) });
    if (t.length) t.push({ type: 'separator' });
    t.push({ label: 'Nouveau groupe avec cet onglet…', click: () => create(tab.spaceId, tab.id) });
    t.unshift({ label: 'Ranger dans', enabled: false });
    t.push({ type: 'separator' });
  }
  t.push({ label: 'Fermer l\'onglet', click: () => tabs().closeTab(tab.id) });
  popup(t);
}

module.exports = { create, rename, remove, assign, groupMenu, tabMenu };
