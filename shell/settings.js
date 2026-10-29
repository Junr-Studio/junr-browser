'use strict';
/* Page Réglages : tout passe par window.junrAdmin.call(nom, args) — aucun accès direct au système. */

const api = (name, args) => window.junrAdmin.call(name, args).catch((e) => {
  throw new Error(String(e.message).replace(/^Error invoking remote method 'admin': (Error: )?/, ''));
});

function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n && k !== 'list') n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}

let toastTimer = null;
function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, err ? 6000 : 2800);
}

// Exécute une action, affiche son résultat, puis redessine la section.
async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    await render();
    return r;
  } catch (e) { toast(e.message, true); }
}

// Bouton à double clic : le premier clic arme, le second confirme (pas de boîte de dialogue bloquante).
function dangerButton(label, confirmLabel, action) {
  const b = h('button', { class: 'btn danger', type: 'button' }, label);
  let armed = false, timer;
  b.addEventListener('click', () => {
    if (!armed) {
      armed = true; b.classList.add('armed'); b.textContent = confirmLabel;
      timer = setTimeout(() => { armed = false; b.classList.remove('armed'); b.textContent = label; }, 4000);
    } else { clearTimeout(timer); action(); }
  });
  return b;
}

const fmtDate = (t) => (t ? new Date(t).toLocaleString('fr-FR') : '—');
const PERM_LABELS = { geolocation: 'Position', notifications: 'Notifications', 'clipboard-read': 'Lecture du presse-papiers', midi: 'MIDI', camera: 'Caméra', microphone: 'Micro' };
const STATUS = {
  portable: ['ok', 'Portable'], 'not-portable': ['bad', 'Non portable'], unverifiable: ['dim', 'Non vérifiable'],
  compatible: ['ok', 'Compatible'], partial: ['warn', 'Partielle'], unsupported: ['bad', 'Non supportée'],
};
const badge = (status, extra) => { const [cls, label] = STATUS[status] || ['dim', status]; return h('span', { class: `badge ${cls}`, title: extra || '' }, label); };

let model = null;
let current = 'clients';
let selectedShareSpace = null;

/* ---------- Clients et outils ---------- */
function toolsTable(spaceId, tools) {
  const rows = tools.map((t) => {
    const name = h('input', { type: 'text', value: t.name, 'aria-label': 'Nom de l\'outil' });
    const url = h('input', { type: 'text', value: t.url, 'aria-label': 'Adresse' });
    const ctl = h('input', { type: 'text', value: t.controlUrl || '', placeholder: 'ex. https://outil/profil', 'aria-label': 'URL de contrôle' });
    const fam = h('input', { type: 'text', value: t.family || '', placeholder: t.name.toLowerCase(), 'aria-label': 'Famille', title: 'Les outils d\'une même famille se suivent d\'un client à l\'autre (Alt+↑ / Alt+↓).' });
    const keep = h('input', { type: 'checkbox', checked: !!t.keepAwake, 'aria-label': 'Garder éveillé' });
    return h('tr', null,
      h('td', null, name), h('td', null, url), h('td', null, ctl), h('td', null, fam), h('td', { title: 'Cet outil ne sera jamais mis en veille (consomme de la mémoire en continu)' }, keep),
      h('td', null, t.portability ? badge(t.portability.status, t.portability.detail) : ''),
      h('td', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => run(() => api('tool.update', { spaceId, toolId: t.id, tool: { name: name.value, url: url.value, controlUrl: ctl.value, keepAwake: keep.checked, family: fam.value } }), 'Outil enregistré') }, 'Enregistrer'),
        dangerButton('Supprimer', 'Confirmer ?', () => run(() => api('tool.delete', { spaceId, toolId: t.id }), 'Outil supprimé'))));
  });
  const nName = h('input', { type: 'text', placeholder: 'Nom', 'aria-label': 'Nouvel outil : nom' });
  const nUrl = h('input', { type: 'text', placeholder: 'https://…', 'aria-label': 'Nouvel outil : adresse' });
  const nCtl = h('input', { type: 'text', placeholder: 'URL de contrôle (optionnel)', 'aria-label': 'Nouvel outil : URL de contrôle' });
  return h('table', { class: 'tools' },
    h('thead', null, h('tr', null, h('th', null, 'Outil'), h('th', null, 'Adresse'), h('th', null, 'URL de contrôle (page accessible connecté)'), h('th', { title: 'Les outils d\'une même famille se suivent d\'un client à l\'autre.' }, 'Famille (Alt+↑/↓)'), h('th', null, 'Éveillé'), h('th', null, 'Partage'), h('th'))),
    h('tbody', null, rows,
      h('tr', null, h('td', null, nName), h('td', null, nUrl), h('td', null, nCtl), h('td'), h('td'), h('td'),
        h('td', null, h('button', { class: 'btn primary', type: 'button', onclick: () => run(() => api('tool.add', { spaceId, tool: { name: nName.value, url: nUrl.value, controlUrl: nCtl.value } }), 'Outil ajouté') }, 'Ajouter')))));
}

function sectionClients() {
  const list = model.clients.map((c, i) => {
    const name = h('input', { type: 'text', value: c.name, 'aria-label': `Nom du client ${c.name}` });
    const color = h('input', { type: 'color', value: c.color, class: 'swatch', 'aria-label': 'Couleur' });
    const crit = h('input', { type: 'checkbox', checked: !!c.critical, 'aria-label': 'Client sensible' });
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, color, name,
        h('button', { class: 'btn', type: 'button', onclick: () => run(() => api('client.rename', { id: c.id, name: name.value, color: color.value, critical: crit.checked }), 'Client enregistré') }, 'Enregistrer'),
        h('button', { class: 'btn', type: 'button', disabled: i === 0, 'aria-label': 'Monter', onclick: () => run(() => api('client.move', { id: c.id, delta: -1 })) }, '↑'),
        h('button', { class: 'btn', type: 'button', disabled: i === model.clients.length - 1, 'aria-label': 'Descendre', onclick: () => run(() => api('client.move', { id: c.id, delta: 1 })) }, '↓'),
        dangerButton('Supprimer le client', 'Effacer ses données ?', () => run(() => api('client.delete', { id: c.id }), 'Client supprimé'))),
      h('label', { class: 'row' }, crit, 'Client sensible : cadre épais autour des pages, pour ne jamais confondre'),
      i < 9 ? h('div', { class: 'muted' }, `Raccourci : Ctrl+${i + 1}`) : null,
      toolsTable(c.id, c.tools));
  });
  const nName = h('input', { type: 'text', placeholder: 'Nom du nouveau client', 'aria-label': 'Nom du nouveau client' });
  return [
    h('h1', null, 'Clients et outils'),
    h('p', { class: 'lead' }, 'Chaque client a ses propres cookies et son propre stockage, séparés des autres. L\'ordre ci-dessous est celui des raccourcis Ctrl+1 à 9. Supprimer un client efface ses données.'),
    list,
    h('div', { class: 'card' }, h('h2', null, 'Nouveau client'),
      h('div', { class: 'row' }, nName, h('button', { class: 'btn primary', type: 'button', onclick: () => run(() => api('client.add', { name: nName.value }), 'Client ajouté') }, 'Ajouter'))),
    h('div', { class: 'card' }, h('h2', null, 'Outils communs'),
      h('p', { class: 'muted' }, 'Disponibles dans tous les clients avec une seule connexion.'),
      toolsTable('global', model.globalTools)),
  ];
}

/* ---------- Veille ---------- */
function sectionSleep() {
  const s = model.settings;
  const minutes = h('input', { type: 'number', min: '1', step: '1', value: String(Math.round(s.unloadAfterMs / 60000)), 'aria-label': 'Délai en minutes' });
  const mem = h('input', { type: 'number', min: '0', step: '100', value: String(s.memThresholdMb), 'aria-label': 'Seuil de RAM en Mo' });
  const protect = h('input', { type: 'checkbox', checked: s.protectDrafts !== false, 'aria-label': 'Protéger les brouillons' });
  const excl = h('textarea', { 'aria-label': 'Sites exclus', placeholder: 'mail.example.com\n*.slack.com' }, s.sleepExclusions.join('\n'));
  return [
    h('h1', null, 'Mise en veille'),
    h('p', { class: 'lead' }, 'Les onglets des clients non consultés sont déchargés pour libérer de la RAM, puis rechargés avec leur position de défilement. Les outils communs et le client affiché ne sont jamais mis en veille.'),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('label', null, 'Mise en veille après (minutes)', minutes), h('label', null, 'Seuil de RAM (Mo, 0 = désactivé)', mem)),
      h('p', { class: 'muted' }, 'Au-delà du seuil, les onglets inactifs les plus anciens sont endormis sans attendre le délai.'),
      h('label', { class: 'row' }, protect, 'Ne jamais endormir un onglet qui contient du texte non envoyé (brouillon)'),
      h('label', null, 'Sites jamais mis en veille (un par ligne ; « *.domaine » pour les sous-domaines)', excl),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => run(() => api('settings.set', {
        unloadAfterMs: Number(minutes.value) * 60000, memThresholdMb: Number(mem.value), sleepExclusions: excl.value.split('\n'), protectDrafts: protect.checked,
      }), 'Réglages de veille enregistrés') }, 'Enregistrer'))),
  ];
}

/* ---------- Extensions ---------- */
async function sectionExtensions() {
  const [exts, cov] = await Promise.all([api('ext.list'), api('bridge.coverage')]);
  const shimBox = h('input', { type: 'checkbox', checked: cov.enabled });
  const input = h('input', { type: 'text', placeholder: 'Identifiant (32 lettres) ou adresse du Chrome Web Store', 'aria-label': 'Extension à installer', style: 'flex:1;min-width:280px' });
  const install = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    install.disabled = true; install.textContent = 'Installation…';
    await run(async () => {
      const r = await api('ext.install', { input: input.value });
      toast(`${r.name} ${r.version} : ${(STATUS[r.compat?.status] || [0, '?'])[1]}`);
    });
  } }, 'Installer');
  const list = exts.map((x) => {
    const c = x.compat;
    const details = c ? [
      c.missing.length ? `API absentes d'Electron : ${c.missing.join(', ')}` : null,
      c.optionalMissing.length ? `API optionnelles absentes : ${c.optionalMissing.join(', ')}` : null,
      ...c.notes,
      c.suggestions.length ? `Remplaçable par : ${c.suggestions.join(' ; ')}` : null,
    ].filter(Boolean) : [];
    return h('div', { class: 'card ext' },
      x.icon ? h('img', { src: x.icon, alt: '' }) : h('div', { class: 'ph', 'aria-hidden': 'true' }, x.name.slice(0, 1).toUpperCase()),
      h('div', { class: 'body' },
        h('div', { class: 'row' }, h('strong', null, x.name), h('span', { class: 'muted' }, `v${x.version}`),
          x.bundled ? h('span', { class: 'badge dim' }, 'Fournie avec l\'application') : (c ? badge(c.status) : null),
          !x.enabled ? h('span', { class: 'badge dim' }, 'Désactivée') : null),
        h('div', { class: 'muted mono' }, x.id),
        x.loadError ? h('div', { class: 'muted', style: 'color:var(--danger)' }, `Erreur de chargement : ${x.loadError}`) : null,
        details.map((d) => h('div', { class: 'muted' }, d))),
      x.bundled ? null : h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => run(() => api('ext.setEnabled', { id: x.id, enabled: !x.enabled }), x.enabled ? 'Extension désactivée' : 'Extension activée') }, x.enabled ? 'Désactiver' : 'Activer'),
        dangerButton('Désinstaller', 'Confirmer ?', () => run(() => api('ext.uninstall', { id: x.id }), 'Extension désinstallée'))));
  });
  return [
    h('h1', null, 'Extensions'),
    h('p', { class: 'lead' }, 'Une extension s\'installe une fois et s\'applique à tous les clients (une instance par client : son état local est donc propre à chaque client, ses comptes cloud sont communs). Electron n\'implémente qu\'une partie des API d\'extensions : la compatibilité est indiquée à l\'installation.'),
    h('div', { class: 'card' }, h('h2', null, 'Pont d\'API chrome.*'),
      h('p', { class: 'muted' }, 'Electron n\'implémente qu\'une partie des API d\'extensions. Le pont de Junr Browser en ajoute (liste ci-dessous) ; il est appliqué aux extensions au prochain chargement.'),
      h('label', { class: 'inline' }, shimBox, 'Activer le pont d\'API'),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => run(() => api('settings.set', { extensionShims: shimBox.checked }), 'Réglage enregistré (redémarrez l\'application pour recharger les extensions)') }, 'Enregistrer')),
      h('p', null, h('strong', null, 'Implémentées : '), cov.bridged.join(', ')),
      h('p', { class: 'muted' }, h('strong', null, 'Non prises en charge (erreur explicite) : '), cov.unsupported.join(', '), ' · ', h('strong', null, 'Inertes (sans effet) : '), cov.inert.join(', '), ' · ', h('strong', null, 'Absente d\'Electron : '), 'nativeMessaging')),
    h('div', { class: 'card' }, h('h2', null, 'Installer depuis le Chrome Web Store'),
      h('div', { class: 'row' }, input, install),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => run(async () => {
        const r = await api('ext.checkUpdates');
        toast(r.updated.length ? `${r.updated.length} extension(s) mise(s) à jour` : 'Toutes les extensions sont à jour');
      }) }, 'Vérifier les mises à jour'), h('span', { class: 'muted' }, 'Vérification automatique toutes les 6 heures.'))),
    list.length ? list : h('p', { class: 'muted' }, 'Aucune extension installée.'),
  ];
}

/* ---------- Permissions ---------- */
async function sectionPermissions() {
  const perms = await api('perm.list');
  const nameOf = (id) => model.clients.find((c) => c.id === id)?.name || id;
  const rows = perms.sort((a, b) => nameOf(a.spaceId).localeCompare(nameOf(b.spaceId)) || a.origin.localeCompare(b.origin)).map((p) => {
    const sel = h('select', { 'aria-label': `Décision pour ${p.origin}`, onchange: () => run(() => api('perm.set', { ...p, decision: sel.value }), 'Permission modifiée') },
      h('option', { value: 'allow', selected: p.decision === 'allow' }, 'Autoriser'), h('option', { value: 'deny', selected: p.decision === 'deny' }, 'Refuser'));
    return h('tr', null, h('td', null, nameOf(p.spaceId)), h('td', { class: 'mono' }, p.origin), h('td', null, PERM_LABELS[p.permission] || p.permission), h('td', null, sel),
      h('td', null, h('button', { class: 'btn', type: 'button', onclick: () => run(() => api('perm.remove', p), 'Choix oublié') }, 'Oublier')));
  });
  return [
    h('h1', null, 'Permissions des sites'),
    h('p', { class: 'lead' }, 'Un site demande l\'accès à la caméra, au micro, à la position, aux notifications ou au presse-papiers : le choix est mémorisé par site et par client. « Oublier » redemande au prochain accès.'),
    rows.length ? h('div', { class: 'card' }, h('table', { class: 'log' },
      h('thead', null, h('tr', null, h('th', null, 'Client'), h('th', null, 'Site'), h('th', null, 'Permission'), h('th', null, 'Décision'), h('th'))), h('tbody', null, rows)))
      : h('p', { class: 'muted' }, 'Aucun choix mémorisé.'),
  ];
}

/* ---------- Fonctions natives ---------- */
async function sectionNative() {
  const [cfg, pws] = await Promise.all([api('native.get'), api('pw.list')]);
  const rules = h('textarea', { 'aria-label': 'Règles de blocage', placeholder: 'ads.example.com\n*://*/tracker.js' }, cfg.blocking.rules.join('\n'));
  const enabled = h('input', { type: 'checkbox', checked: cfg.blocking.enabled });

  const inj = cfg.injection.map((r) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('strong', null, r.name), h('span', { class: 'muted mono' }, r.match), r.enabled ? null : h('span', { class: 'badge dim' }, 'Désactivée'),
      h('button', { class: 'btn', type: 'button', onclick: () => run(() => api('native.saveInjection', { ...r, enabled: !r.enabled })) }, r.enabled ? 'Désactiver' : 'Activer'),
      dangerButton('Supprimer', 'Confirmer ?', () => run(() => api('native.deleteInjection', { id: r.id })))),
    r.css ? h('pre', { class: 'mono muted' }, r.css) : null, r.js ? h('pre', { class: 'mono muted' }, r.js) : null));
  const iName = h('input', { type: 'text', placeholder: 'Nom', 'aria-label': 'Nom de la règle' });
  const iMatch = h('input', { type: 'text', placeholder: 'https://*.exemple.com/*', 'aria-label': 'Motif d\'URL' });
  const iCss = h('textarea', { 'aria-label': 'CSS à injecter', placeholder: 'CSS à injecter' });
  const iJs = h('textarea', { 'aria-label': 'Script à injecter', placeholder: 'JavaScript à exécuter dans la page' });

  const scope = h('select', { 'aria-label': 'Valable pour' }, h('option', { value: '' }, 'Tous les clients'), model.clients.map((c) => h('option', { value: c.id }, c.name)));
  const pOrigin = h('input', { type: 'text', placeholder: 'https://app.exemple.com', 'aria-label': 'Site' });
  const pUser = h('input', { type: 'text', placeholder: 'Identifiant', 'aria-label': 'Identifiant', autocomplete: 'off' });
  const pPass = h('input', { type: 'password', placeholder: 'Mot de passe', 'aria-label': 'Mot de passe', autocomplete: 'new-password' });
  const pwRows = pws.map((p) => h('tr', null, h('td', { class: 'mono' }, p.origin), h('td', null, p.username), h('td', null, p.spaceId ? (model.clients.find((c) => c.id === p.spaceId)?.name || p.spaceId) : 'Tous'),
    h('td', null, dangerButton('Supprimer', 'Confirmer ?', () => run(() => api('pw.delete', { id: p.id }))))));

  return [
    h('h1', null, 'Fonctions natives'),
    h('p', { class: 'lead' }, 'Ces fonctions remplacent les extensions qui exigent un état unique : elles s\'appliquent à tous les clients, sans rien à synchroniser.'),
    h('div', { class: 'card' }, h('h2', null, 'Blocage réseau'),
      h('label', { class: 'inline' }, enabled, 'Activé'),
      h('p', { class: 'muted' }, 'Un domaine par ligne (sous-domaines inclus), ou un motif d\'URL avec « * ». ' + `Requêtes bloquées depuis le lancement : ${cfg.blockedCount}.`),
      rules, h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => run(() => api('native.setBlocking', { enabled: enabled.checked, rules: rules.value.split('\n') }), 'Blocage enregistré') }, 'Enregistrer'))),
    h('div', { class: 'card' }, h('h2', null, 'Injection de scripts et de CSS'), inj,
      h('div', { class: 'row grow' }, iName, iMatch), iCss, iJs,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => run(() => api('native.saveInjection', { name: iName.value, match: iMatch.value, css: iCss.value, js: iJs.value, enabled: true }), 'Règle ajoutée') }, 'Ajouter la règle'))),
    h('div', { class: 'card' }, h('h2', null, 'Mots de passe intégrés'),
      cfg.passwordsAvailable ? h('p', { class: 'muted' }, 'Chiffrés avec le coffre du système. Le remplissage est toujours demandé par vous : Ctrl+Maj+L ou le bouton 🔑 de la barre d\'adresse.')
        : h('p', { class: 'muted', style: 'color:var(--danger)' }, 'Coffre de chiffrement du système indisponible : l\'enregistrement est désactivé.'),
      pwRows.length ? h('table', { class: 'log' }, h('thead', null, h('tr', null, h('th', null, 'Site'), h('th', null, 'Identifiant'), h('th', null, 'Valable pour'), h('th'))), h('tbody', null, pwRows)) : null,
      h('div', { class: 'row grow' }, pOrigin, pUser, pPass, scope),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', disabled: !cfg.passwordsAvailable, onclick: () => run(async () => {
        await api('pw.save', { origin: pOrigin.value, username: pUser.value, password: pPass.value, spaceId: scope.value || null });
      }, 'Mot de passe enregistré') }, 'Enregistrer'))),
  ];
}

/* ---------- Téléchargements et historique ---------- */
async function sectionDownloads() {
  const [list, stats] = await Promise.all([api('downloads.list'), api('history.stats')]);
  const nameOf = (id) => model.clients.find((c) => c.id === id)?.name || (id === 'global' ? 'Outils communs' : id);
  const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : n >= 1024 ? `${Math.round(n / 1024)} Ko` : `${Math.max(n, 0)} o`);
  const STATE = { complete: 'Terminé', in_progress: 'En cours', interrupted: 'Interrompu' };
  const rows = list.map((d) => h('tr', null, h('td', { class: 'mono' }, d.filename.split(/[\\/]/).pop()), h('td', null, nameOf(d.spaceId)), h('td', null, STATE[d.state] || d.state), h('td', null, size(d.fileSize)),
    h('td', null, fmtDate(d.startTime)), h('td', { class: 'row' },
      h('button', { class: 'btn', type: 'button', disabled: d.state !== 'complete' || !d.exists, onclick: () => run(() => api('downloads.open', { id: d.id })) }, 'Ouvrir'),
      h('button', { class: 'btn', type: 'button', disabled: !d.exists, onclick: () => run(() => api('downloads.show', { id: d.id })) }, 'Afficher'))));
  const rec = h('input', { type: 'checkbox', checked: model.settings.recordHistory !== false });
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  return [
    h('h1', null, 'Téléchargements et historique'),
    h('p', { class: 'lead' }, 'Les fichiers téléchargés sont enregistrés dans le dossier Téléchargements du système, sans boîte de dialogue, avec un nom unique. L\'historique est tenu séparément pour chaque client ; il alimente chrome.history et chrome.topSites des extensions.'),
    h('div', { class: 'card' }, h('h2', null, 'Téléchargements récents'),
      rows.length ? h('table', { class: 'log' }, h('thead', null, h('tr', null, ['Fichier', 'Client', 'État', 'Taille', 'Début', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)) : h('p', { class: 'muted' }, 'Aucun téléchargement depuis le lancement.')),
    h('div', { class: 'card' }, h('h2', null, 'Historique de navigation'),
      h('label', { class: 'inline' }, rec, 'Enregistrer l\'historique'),
      h('p', { class: 'muted' }, `${total} page(s) mémorisée(s) : ${Object.entries(stats).map(([id, n]) => `${nameOf(id)} ${n}`).join(', ') || 'aucune'}. Supprimer un client supprime aussi son historique.`),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => run(() => api('settings.set', { recordHistory: rec.checked }), 'Réglage enregistré') }, 'Enregistrer'),
        dangerButton('Effacer tout l\'historique', 'Confirmer ?', () => run(() => api('history.clear', {}), 'Historique effacé')))),
  ];
}

/* ---------- Partage ---------- */
async function sectionShare() {
  const [me, log, relayCfg] = await Promise.all([api('share.me'), api('share.log'), api('relay.get')]);
  if (!selectedShareSpace || !model.clients.some((c) => c.id === selectedShareSpace)) selectedShareSpace = model.clients[0]?.id;
  const spaceSel = h('select', { 'aria-label': 'Client à partager', onchange: () => { selectedShareSpace = spaceSel.value; render(); } },
    model.clients.map((c) => h('option', { value: c.id, selected: c.id === selectedShareSpace }, c.name)));
  const recipient = h('textarea', { 'aria-label': 'Identifiant de partage du destinataire', placeholder: 'Collez ici l\'identifiant de partage du destinataire' });
  const ttl = h('select', { 'aria-label': 'Durée de validité' }, [[1, '1 heure'], [24, '24 heures'], [72, '3 jours']].map(([v, l]) => h('option', { value: v, selected: v === 24 }, l)));
  const result = h('div');
  const codeOut = h('div', { class: 'mono', 'aria-live': 'polite' });
  const relayUrl = h('input', { type: 'text', value: relayCfg.url, placeholder: 'https://relais.exemple.com', 'aria-label': 'Adresse du relais', style: 'flex:1;min-width:260px' });
  const relayToken = h('input', { type: 'password', placeholder: relayCfg.hasToken ? 'Jeton enregistré (laisser vide pour le conserver)' : 'Jeton d\'accès', 'aria-label': 'Jeton du relais', autocomplete: 'off', style: 'flex:1;min-width:220px' });
  const retrieveCode = h('input', { type: 'text', placeholder: 'Code de retrait', 'aria-label': 'Code de retrait', style: 'flex:1;min-width:300px' });
  const copy = () => { navigator.clipboard?.writeText(me.shareId).then(() => toast('Identifiant copié'), () => toast('Copie impossible : sélectionnez le texte', true)); };
  const showStatuses = (statuses) => result.replaceChildren(h('table', { class: 'log' },
    h('thead', null, h('tr', null, h('th', null, 'Outil'), h('th', null, 'Statut'), h('th', null, 'Détail'))),
    h('tbody', null, statuses.map((s) => h('tr', null, h('td', null, s.name), h('td', null, badge(s.status)), h('td', { class: 'muted' }, s.detail || ''))))));

  const logRows = log.map((l) => h('tr', null, h('td', null, fmtDate(l.when)), h('td', null, l.direction === 'export' ? 'Envoi' : 'Réception'), h('td', null, l.user), h('td', null, l.space),
    h('td', { class: 'mono' }, l.peer), h('td', null, (l.tools || []).map((t) => `${t.name} : ${(STATUS[t.status] || [0, t.status])[1]}`).join(' ; '))));

  return [
    h('h1', null, 'Partage d\'un client'),
    h('p', { class: 'lead' }, 'Le destinataire reçoit les cookies et le stockage local du client et arrive connecté sans ressaisir d\'identifiants. Seuls les outils dont le test de portabilité réussit sont transmis ; les autres sont signalés « non portables ».'),
    h('div', { class: 'card' }, h('h2', null, 'Mon identifiant de partage'),
      h('p', { class: 'muted' }, 'À donner aux collaborateurs qui veulent vous envoyer un client. Il ne permet que de chiffrer un paquet pour vous.'),
      h('div', { class: 'mono' }, me.shareId), h('div', { class: 'row' }, h('span', { class: 'muted' }, `Empreinte de chiffrement : ${me.fingerprint} · de signature : ${me.signFingerprint}`), h('button', { class: 'btn', type: 'button', onclick: copy }, 'Copier'))),
    h('div', { class: 'card' }, h('h2', null, 'Envoyer un client'),
      h('div', { class: 'row' }, h('label', null, 'Client', spaceSel)),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Test en cours…';
        try { const r = await api('share.preview', { spaceId: spaceSel.value }); showStatuses(r.statuses); toast(`${r.cookies} cookies, ${r.origins} origine(s) de stockage local`); }
        catch (err) { toast(err.message, true); }
        e.target.disabled = false; e.target.textContent = 'Tester la portabilité';
      } }, 'Tester la portabilité'), h('span', { class: 'muted' }, 'Charge la page de contrôle de chaque outil dans une session vierge, avec les données exportées.')),
      result,
      h('label', null, 'Destinataire', recipient),
      h('div', { class: 'row' }, h('label', null, 'Validité', ttl),
        h('button', { class: 'btn primary', type: 'button', onclick: (e) => run(async () => {
          e.target.disabled = true;
          const r = await api('share.export', { spaceId: spaceSel.value, recipient: recipient.value, ttlHours: Number(ttl.value) });
          toast(r.saved ? `Paquet enregistré (valable jusqu'au ${fmtDate(r.expiresAt)})` : 'Export annulé');
        }) }, 'Exporter dans un fichier…'),
        h('button', { class: 'btn primary', type: 'button', disabled: !relayCfg.url || !relayCfg.hasToken, title: relayCfg.url ? '' : 'Configurez le relais ci-dessous', onclick: (e) => run(async () => {
          e.target.disabled = true;
          const r = await api('share.exportRelay', { spaceId: spaceSel.value, recipient: recipient.value, ttlHours: Number(ttl.value) });
          codeOut.textContent = r.code;
          toast(`Paquet déposé sur le relais. Donnez ce code au destinataire (valable jusqu'au ${fmtDate(r.expiresAt)})`);
        }) }, 'Envoyer via le relais')),
      codeOut,
      h('p', { class: 'muted' }, 'Risque : le paquet équivaut à un accès à vos comptes sur ces outils. Il expire, ne s\'importe qu\'une fois, et ne se révoque qu\'en se déconnectant côté outil. Vérifiez que les conditions d\'utilisation de l\'outil autorisent ce partage.')),
    h('div', { class: 'card' }, h('h2', null, 'Relais Junr'),
      h('p', { class: 'muted' }, 'Le relais ne transporte que des paquets déjà chiffrés pour le destinataire : il impose l\'expiration et l\'usage unique, supprime le paquet à la récupération et journalise qui a envoyé quoi. Il doit être en HTTPS.'),
      h('div', { class: 'row' }, relayUrl, relayToken),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => run(() => api('relay.set', { url: relayUrl.value, token: relayToken.value }), 'Relais enregistré') }, 'Enregistrer le relais'))),
    h('div', { class: 'card' }, h('h2', null, 'Recevoir un client'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: (e) => run(async () => {
        e.target.disabled = true;
        const r = await api('share.import');
        if (r.imported) toast(`« ${r.name} » importé`);
      }) }, 'Importer un fichier…')),
      h('div', { class: 'row' }, retrieveCode, h('button', { class: 'btn primary', type: 'button', disabled: !relayCfg.url || !relayCfg.hasToken, onclick: (e) => run(async () => {
        e.target.disabled = true;
        const r = await api('share.importRelay', { code: retrieveCode.value });
        if (r.imported) toast(`« ${r.name} » importé`);
      }) }, 'Récupérer via le relais'))),
    h('div', { class: 'card' }, h('h2', null, 'Journal des partages'),
      logRows.length ? h('table', { class: 'log' }, h('thead', null, h('tr', null, ['Quand', 'Sens', 'Qui', 'Client', 'Contrepartie', 'Outils'].map((t) => h('th', null, t)))), h('tbody', null, logRows))
        : h('p', { class: 'muted' }, 'Aucun partage.')),
  ];
}

/* ---------- Serveurs ---------- */
// Arbre de parcours par fournisseur : { open: Set(chemins ouverts), nodes: Map(chemin -> nœuds déjà chargés) }. Conservé entre deux rendus.
const serverTree = {};
const pathKey = (path) => path.join('/');

async function openServerNode(provider, path) {
  const t = (serverTree[provider] ||= { open: new Set(), nodes: new Map() });
  const k = pathKey(path);
  if (t.open.has(k)) { t.open.delete(k); return render(); }
  if (!t.nodes.has(k)) {
    try { t.nodes.set(k, await api('servers.browse', { provider, path })); } catch (e) { toast(e.message, true); return; }
  }
  t.open.add(k);
  await render();
}

function serverNodes(provider, path, byKey) {
  const t = serverTree[provider];
  const nodes = t?.nodes.get(pathKey(path)) || [];
  if (!nodes.length) return h('p', { class: 'muted' }, 'Rien à afficher ici.');
  return h('ul', { class: 'tree' }, nodes.map((n) => {
    if (n.truncated) return h('li', { class: 'muted' }, n.name);
    if (n.app) {
      const entry = byKey.get(n.app.refKey);
      const box = h('input', { type: 'checkbox', checked: !!entry, 'aria-label': `Observer ${n.app.label}`,
        onchange: () => run(() => (box.checked ? api('servers.observe', { provider, ...n.app }) : api('servers.unobserve', { id: entry.id })), box.checked ? 'App observée' : 'App retirée') });
      return h('li', null, h('label', { class: 'inline' }, box, n.name));
    }
    const sub = [...path, n.id];
    const open = t.open.has(pathKey(sub));
    return h('li', null,
      h('button', { class: 'node', type: 'button', 'data-node': n.id, 'aria-expanded': String(open), onclick: () => openServerNode(provider, sub) }, `${open ? '▾' : '▸'} ${n.name}`),
      open ? serverNodes(provider, sub, byKey) : null);
  }));
}

function serverProviderCard(p, byKey) {
  const ready = p.secrets.every((f) => f.saved);
  const inputs = p.secrets.map((f) => h('input', {
    type: 'password', autocomplete: 'off', style: 'flex:1;min-width:260px',
    'aria-label': `${f.label} ${p.label}`,
    placeholder: f.saved ? 'Enregistré (laisser vide pour le conserver)' : f.label,
  }));
  const save = () => run(async () => {
    for (const [i, f] of p.secrets.entries()) if (inputs[i].value) await api('servers.setSecret', { provider: p.id, key: f.key, value: inputs[i].value });
  }, 'Enregistré');
  const t = serverTree[p.id];
  return h('div', { class: 'card' }, h('h2', null, p.label),
    h('div', { class: 'row' }, inputs,
      h('button', { class: 'btn primary', type: 'button', 'aria-label': `Enregistrer le jeton ${p.label}`, onclick: save }, 'Enregistrer'),
      ready ? dangerButton('Effacer', 'Confirmer ?', () => run(async () => { for (const f of p.secrets) await api('servers.setSecret', { provider: p.id, key: f.key, value: null }); delete serverTree[p.id]; }, 'Jeton effacé')) : null),
    ready ? h('div', null,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', 'aria-label': `Parcourir ${p.label}`, onclick: () => { delete serverTree[p.id]; openServerNode(p.id, []); } }, 'Parcourir et choisir les apps')),
      t?.open.has('') ? serverNodes(p.id, [], byKey) : null) : h('p', { class: 'muted' }, 'Enregistrez le jeton pour parcourir les projets.'));
}

async function sectionServers() {
  const cfg = await api('servers.config');
  const byKey = new Map(cfg.observed.map((o) => [o.refKey, o]));
  const rows = cfg.observed.map((o) => {
    const sel = h('select', { 'aria-label': `Client de ${o.label}`, onchange: () => run(() => api('servers.assign', { id: o.id, clientId: sel.value || null }), 'Rattachement enregistré') },
      h('option', { value: '' }, 'Non rattachée'), model.clients.map((c) => h('option', { value: c.id, selected: c.id === o.clientId }, c.name)));
    return h('tr', null, h('td', null, o.label), h('td', { class: 'muted' }, o.project), h('td', null, sel),
      h('td', null, dangerButton('Retirer', 'Confirmer ?', () => run(() => api('servers.unobserve', { id: o.id }), 'App retirée'))));
  });
  return [
    h('h1', null, 'Serveurs'),
    h('p', { class: 'lead' }, 'Suivez en lecture seule l\'état des serveurs où sont déployés vos projets : en ligne, en déploiement ou dernier déploiement échoué. L\'état se lit au survol de l\'icône des serveurs dans la barre. Le jeton est chiffré par le coffre du système, seules des requêtes de lecture sont envoyées, et uniquement au fournisseur.'),
    cfg.providers.map((p) => serverProviderCard(p, byKey)),
    h('div', { class: 'card' }, h('h2', null, `Apps observées (${cfg.observed.length})`),
      rows.length ? h('table', { class: 'tools' }, h('thead', null, h('tr', null, h('th', null, 'App'), h('th', null, 'Projet'), h('th', null, 'Client'), h('th'))), h('tbody', null, rows))
        : h('p', { class: 'muted' }, 'Aucune app observée. Parcourez un fournisseur et cochez les apps à suivre.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', disabled: !cfg.observed.length, onclick: () => run(() => api('servers.refresh'), 'Relevé effectué') }, 'Actualiser'))),
  ];
}

/* ---------- À propos ---------- */
async function sectionAbout() {
  const [a, up] = await Promise.all([api('about'), api('update.get')]);
  const upText = {
    off: up.reason || 'Désactivées', idle: 'En attente de la prochaine vérification', checking: 'Recherche en cours…',
    uptodate: 'À jour', downloading: `Téléchargement de la version ${up.next || ''} (${up.percent || 0} %)`,
    ready: `Version ${up.next} téléchargée : elle s'installe à la fermeture`, error: `Vérification impossible : ${up.error || 'erreur inconnue'}`,
  }[up.state] || up.state;
  const channel = h('select', { 'aria-label': 'Canal de mise à jour', disabled: up.state === 'off', onchange: () => run(() => api('update.channel', { channel: channel.value }), 'Canal enregistré') },
    [['stable', 'Stable : versions publiées'], ['beta', 'Bêta : dès qu\'une version est construite']].map(([v, l]) => h('option', { value: v, selected: v === up.channel }, l)));
  return [
    h('h1', null, 'À propos et sécurité'),
    h('div', { class: 'card' }, h('h2', null, 'Mises à jour'),
      h('table', { class: 'log' }, h('tbody', null,
        [['Version installée', up.version], ['État', upText], ['Source', up.source]].map(([k, v]) => h('tr', null, h('th', null, k), h('td', { class: up.state === 'error' && k === 'État' ? 'warn' : 'mono' }, v))))),
      h('div', { class: 'row' }, channel,
        h('button', { class: 'btn', type: 'button', disabled: up.state === 'off', onclick: () => run(async () => { await api('update.check'); }, 'Recherche terminée') }, 'Vérifier maintenant'),
        up.state === 'ready' ? h('button', { class: 'btn primary', type: 'button', onclick: () => run(() => api('update.install')) }, 'Redémarrer et installer') : null),
      h('p', { class: 'muted' }, 'Les mises à jour se téléchargent seules en arrière-plan et s\'installent à la fermeture : jamais au milieu de votre travail.')),
    h('div', { class: 'card' }, h('table', { class: 'log' }, h('tbody', null,
      [['Electron', a.electron], ['Chromium', a.chrome], ['Node', a.node], ['Dossier de données', a.userData], ['Chiffrement système', a.secrets ? 'disponible' : 'indisponible']].map(([k, v]) => h('tr', null, h('th', null, k), h('td', { class: 'mono' }, v)))))),
    h('p', { class: 'muted' }, 'Les pages web tournent avec contextIsolation, sandbox et sans nodeIntegration. Mettez Electron à jour à chaque version stable de Chromium (voir docs/ELECTRON-UPDATES.md).'),
  ];
}

/* ---------- Carnets ---------- */
async function sectionCarnets() {
  const list = await api('carnet.get');
  return [
    h('h1', null, 'Carnets'),
    h('p', { class: 'lead' }, 'La prochaine action et les notes de chaque client. Stocké en clair sur cet ordinateur. Jamais envoyé, jamais inclus dans un partage.'),
    list.map((c) => h('div', { class: 'card' },
      h('h2', null, c.name),
      h('p', null, c.carnet.next ? `Prochaine action : ${c.carnet.next.text} (${fmtDate(c.carnet.next.at)})` : 'Aucune prochaine action.'),
      c.carnet.notes.length ? h('table', { class: 'log' }, h('tbody', null, [...c.carnet.notes].reverse().map((n) => h('tr', null,
        h('td', { class: 'mono' }, fmtDate(n.at)), h('td', null, n.text, n.title ? h('div', { class: 'muted' }, n.title) : null),
        h('td', { class: 'row' },
          n.url ? h('button', { class: 'btn', type: 'button', title: `Ce lien s'ouvre avec VOTRE compte chez ${c.name}`, onclick: () => run(() => api('carnet.openLink', { spaceId: c.id, url: n.url })) }, `Ouvrir le lien chez ${c.name}`) : null,
          h('button', { class: 'btn', type: 'button', onclick: () => run(() => api('carnet.deleteNote', { spaceId: c.id, id: n.id }), 'Note supprimée') }, 'Supprimer la note'))))))
        : h('p', { class: 'muted' }, 'Aucune note.'),
      dangerButton('Effacer le carnet', 'Confirmer ?', () => run(() => api('carnet.clear', { spaceId: c.id }), 'Carnet effacé')))),
    h('div', { class: 'card' }, h('h2', null, 'Ctrl+K'),
      h('p', { class: 'muted' }, 'Ctrl+K classe vos outils selon vos habitudes (nombre d\'ouvertures récentes, stocké localement).'),
      h('button', { class: 'btn', type: 'button', onclick: () => run(() => api('usage.clear'), 'Apprentissage effacé') }, 'Effacer l\'apprentissage de Ctrl+K')),
  ];
}

const SECTIONS = {
  clients: ['Clients et outils', sectionClients],
  carnets: ['Carnets', sectionCarnets],
  sleep: ['Mise en veille', sectionSleep],
  extensions: ['Extensions', sectionExtensions],
  permissions: ['Permissions', sectionPermissions],
  native: ['Fonctions natives', sectionNative],
  downloads: ['Téléchargements et historique', sectionDownloads],
  share: ['Partage', sectionShare],
  servers: ['Serveurs', sectionServers],
  about: ['À propos', sectionAbout],
};

async function render() {
  model = await api('all');
  const nav = document.getElementById('nav');
  nav.replaceChildren(...Object.entries(SECTIONS).map(([id, [label]]) =>
    h('button', { type: 'button', 'aria-current': id === current ? 'true' : 'false', onclick: () => { current = id; render(); } }, label)));
  const body = await SECTIONS[current][1]();
  const content = document.getElementById('content');
  const scroll = content.scrollTop;
  content.replaceChildren(...[body].flat(Infinity));
  content.scrollTop = scroll;
}

window.junrAdmin.onSection((s) => { if (SECTIONS[s]) { current = s; render(); } });
render().catch((e) => toast(e.message, true));
