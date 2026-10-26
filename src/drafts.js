'use strict';
// Brouillons : un onglet contenant du texte non envoyé ne doit jamais s'endormir (la veille détruit la page).
// Un script installé dans la page mémorise les champs de saisie réellement touchés par l'utilisateur ; on ne lit JAMAIS
// leur contenu au-delà de « vide ou non », on ne le stocke ni ne le journalise. Détection au mieux : page principale seulement,
// champs standard (input texte, textarea, contenteditable), pas les cadres imbriqués ni les éditeurs qui dessinent leur propre zone.
const { state } = require('./state');

const TIMEOUT_MS = 800;

// Idempotent (gardé par window.__junrDraft). Écouteur en capture : la page ne peut pas le court-circuiter par stopPropagation.
const INSTALL = `(() => {
  if (window.__junrDraft) return;
  const refs = [], known = new WeakSet();
  const SKIP = 'input[type=password],input[type=search],input[type=checkbox],input[type=radio],input[type=button],input[type=submit],input[type=reset],input[type=hidden],input[type=file],input[type=range],input[type=color],input[type=image]';
  const editable = (el) => el instanceof HTMLElement && !el.matches(SKIP) && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el.isContentEditable);
  document.addEventListener('input', (e) => {
    let t = e.target;
    if (t instanceof HTMLElement && !(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement) && t.isContentEditable) {
      while (t.parentElement && t.parentElement.isContentEditable) t = t.parentElement; // la racine éditable
    }
    if (editable(t) && !known.has(t)) { known.add(t); refs.push(new WeakRef(t)); }
  }, true);
  Object.defineProperty(window, '__junrDraft', { value: { has() {
    for (const r of refs) {
      const el = r.deref();
      if (!el || !el.isConnected) continue;
      const v = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ? el.value : el.textContent;
      if (String(v).trim()) return true;
    }
    return false;
  } }, enumerable: false });
})()`;

function install(wc) {
  if (wc.isDestroyed()) return;
  wc.executeJavaScript(INSTALL).catch(() => { /* page non scriptable (erreur réseau, PDF…) */ });
}

// Interroge un onglet ; en cas de délai on garde l'ancienne valeur (un onglet qui ne répond pas ne bloque jamais la veille).
async function check(tab) {
  if (!tab.view || tab.view.webContents.isDestroyed()) return;
  const wc = tab.view.webContents;
  const answer = await Promise.race([
    wc.executeJavaScript('window.__junrDraft ? window.__junrDraft.has() : false').catch(() => undefined),
    new Promise((r) => setTimeout(() => r(undefined), TIMEOUT_MS)),
  ]);
  if (typeof answer === 'boolean') { tab.draft = answer; tab.draftAt = Date.now(); }
}

async function refreshAll(exceptActive = true) {
  const list = [...state.tabs.values()].filter((t) => t.view && !t.internal && !(exceptActive && t.id === state.activeTab));
  await Promise.all(list.map(check));
}

module.exports = { INSTALL, install, check, refreshAll };
