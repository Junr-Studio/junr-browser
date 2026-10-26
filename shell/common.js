'use strict';
// Aides partagées par la barre du haut (shell.js) et les volets (flyout.js).
const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function ago(t) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}

function duration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${Math.floor(h / 24)} j`;
}

/* Pastilles : la forme dit l'état de l'outil (jamais la couleur seule) */
function dotKind(r) {
  if (r.auth === 'login') return 'login';
  if (r.audible) return 'audio';
  if (r.delta > 0) return 'moved';
  return r.state; // never | sleep | live
}

function dot(r, color) {
  const d = el('span', `pd ${dotKind(r)}`);
  d.style.setProperty('--c', color);
  return d;
}

// Carré d'icône d'un onglet : la favicon si elle est connue, sinon la lettre de l'outil sur la couleur du client.
function favicon(icon, letter, color) {
  const box = el('span', 'fav');
  box.style.setProperty('--c', color || '#7b8794');
  if (icon) {
    const img = el('img');
    img.alt = '';
    img.src = icon;
    img.onerror = () => { img.remove(); box.classList.add('letter'); box.textContent = letter || '·'; };
    box.append(img);
  } else { box.classList.add('letter'); box.textContent = letter || '·'; }
  return box;
}
