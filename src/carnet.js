'use strict';
// Carnet du client : une « prochaine action » (une phrase) et un journal de notes datées. Stocké en clair dans le store local,
// jamais envoyé nulle part ni inclus dans un paquet de partage (share.js n'exporte que le nom, la couleur et les outils).
const crypto = require('node:crypto');
const { state } = require('./state');

const MAX_NEXT = 120;
const MAX_NOTES = 200;

function client(spaceId) {
  const c = state.store.data.clients.find((x) => x.id === spaceId);
  if (!c) throw new Error('Client inconnu');
  c.carnet ||= { next: null, notes: [] };
  return c;
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function setNext(spaceId, text) {
  const c = client(spaceId);
  const t = clip(text, MAX_NEXT);
  c.carnet.next = t ? { text: t, at: Date.now() } : null;
  state.store.save();
}

function addNote(spaceId, { text, url, title } = {}) {
  const c = client(spaceId);
  const t = clip(text, 2000);
  if (!t) return null;
  const note = { id: crypto.randomUUID(), at: Date.now(), text: t };
  if (url && /^https?:/i.test(url)) { note.url = String(url); note.title = clip(title, 200); }
  c.carnet.notes.push(note);
  if (c.carnet.notes.length > MAX_NOTES) c.carnet.notes.splice(0, c.carnet.notes.length - MAX_NOTES);
  state.store.save();
  return note;
}

// « Fait » : la phrase rejoint le journal, le champ se vide.
function done(spaceId) {
  const c = client(spaceId);
  const n = c.carnet.next;
  if (!n) return;
  c.carnet.next = null;
  addNote(spaceId, { text: `Fait : ${n.text}` });
  state.store.save();
}

function deleteNote(spaceId, id) {
  const c = client(spaceId);
  c.carnet.notes = c.carnet.notes.filter((n) => n.id !== id);
  state.store.save();
}

function clear(spaceId) {
  client(spaceId).carnet = { next: null, notes: [] };
  state.store.save();
}

const get = (spaceId) => client(spaceId).carnet;
const nextOf = (c) => (c.carnet?.next ? { text: c.carnet.next.text, at: c.carnet.next.at } : null);

module.exports = { setNext, addNote, done, deleteNote, clear, get, nextOf, MAX_NEXT, MAX_NOTES };
