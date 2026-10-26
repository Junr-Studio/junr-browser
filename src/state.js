'use strict';
// État partagé de l'application (un seul processus principal, un seul objet).
const { EventEmitter } = require('node:events');

module.exports = {
  // Bus d'événements internes (onglets, navigation, fenêtre) : le pont d'API d'extensions s'y abonne.
  bus: new EventEmitter(),
  state: {
    store: null,
    win: null,
    shell: null,
    tabs: new Map(),
    nextId: 1,
    activeSpace: null,
    activeTab: null,
    lastTabBySpace: {},
    activeGroup: {}, // client → groupe affiché dans la barre du haut (absent : tous les onglets ; jamais persisté)
    mru: [],        // clients par dernier passage, tête = client courant (jamais « global »)
    leftAt: {},     // client → horodatage de son dernier départ
    resume: null,   // carte « Depuis votre départ » : { spaceId, absentMs, expires, items, sleeping }
    resumeFor: null,
    vitrine: false, // mode vitrine : autres clients masqués (jamais persisté)
    notice: null,   // { text, until } : message calme affiché sous la marque
    sessions: new Map(),
    internalViews: new Set(), // ids des webContents autorisés à appeler l'API d'administration
    diagUrl: null,
    test: false,
  },
  SIDEBAR_W: 0,         // plus de barre latérale : la page occupe toute la largeur (mêmes proportions que Chrome)
  TOPBAR_H: 46,         // une seule barre en haut, qui sert aussi de barre de titre
  FRAME_W: 3,           // liseré de la couleur du client en haut de la barre (identité du lieu)
  FRAME_CRITICAL_W: 6,  // liseré d'un client marqué « sensible »
};
