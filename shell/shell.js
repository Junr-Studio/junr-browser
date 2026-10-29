'use strict';
// Barre unique du haut : avatar du client (survol : liste des clients), onglets en icônes, adresse, extensions.
// Les volets (clients, extensions) sont des vues natives à part, ouvertes par le processus principal (voir flyout.js).
let current = null;
document.body.classList.add(`plat-${window.junr.platform}`);

/* ---------- Adresse « domaine d'abord » : le site en gras, le chemin discret. Le champ réel reste dessous pour la saisie. ---------- */
function renderAddress(url) {
  const v = $('addrview');
  v.replaceChildren();
  if (!url) { v.append(el('span', 'rest', 'Adresse ou recherche (Ctrl+L)')); return; }
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) { v.append(el('span', 'plain', url)); return; }
    const rest = (u.pathname === '/' ? '' : u.pathname) + u.search;
    v.append(el('span', 'sch', u.protocol === 'https:' ? '🔒 ' : 'http:// '), el('span', 'host', u.host.replace(/^www\./, '')), el('span', 'rest', rest));
  } catch { v.append(el('span', 'plain', url)); }
}

/* ---------- Identité du lieu : couleur du client, liseré, avatar ---------- */
function renderIdentity(s) {
  document.body.classList.toggle('commun', s.zone === 'commun');
  document.body.classList.toggle('interne', s.zone === 'interne');
  document.documentElement.style.setProperty('--frame', `${s.frameW}px`);
  const glyph = $('avatar-glyph');
  // La couleur suit toujours le lieu : jamais celle du dernier client une fois sorti (commun, réglages).
  const accent = s.zone === 'client' && s.activeClient ? s.activeClient.color : s.zone === 'commun' ? '#7b8794' : '#7d8a9b';
  document.documentElement.style.setProperty('--accent', accent);
  glyph.textContent = s.zone === 'client' && s.activeClient ? s.activeClient.glyph : s.zone === 'commun' ? '∗' : '⚙';
  const label = s.zone === 'client' && s.activeClient ? s.activeClient.name : s.zone === 'commun' ? 'Commun · aucun client' : 'Réglages';
  const ids = s.queueCount > 0 ? ` · ${s.queueCount} signal${s.queueCount > 1 ? 'aux' : ''} ailleurs` : '';
  $('avatar').setAttribute('aria-label', `${label}${ids}. Entrée ou survol : liste des clients.`);
  const badge = $('avatar-badge');
  badge.hidden = !(s.queueCount > 0);
  badge.textContent = String(s.queueCount || '');
  // Vue de groupe courante : une puce discrète rappelle ce que la barre filtre.
  const sp = s.spaces.find((x) => x.id === s.activeSpace);
  const chip = $('groupchip');
  const g = s.zone === 'client' && sp && sp.group ? (sp.group === '__none' ? 'Sans groupe' : (sp.groups.find((x) => x.id === sp.group) || {}).name) : null;
  chip.hidden = !g;
  chip.textContent = g || '';
  chip.title = 'Vous ne voyez que ce groupe d\'onglets · cliquer pour changer';
}

/* ---------- Onglets : icônes seules, titre au survol ---------- */
function tabTitle(t) {
  const bits = [t.title];
  try { if (!t.internal) bits.push(new URL(t.url).host.replace(/^www\./, '')); } catch { /* pas d'adresse */ }
  if (t.global) bits.unshift('Outil commun');
  if (t.auth === 'login') bits.push('connexion demandée');
  if (t.audible) bits.push('son en cours');
  if (t.delta > 0) bits.push(`+${t.delta}`);
  if (!t.loaded) bits.push('en veille');
  if (t.draft) bits.push('brouillon non envoyé');
  return bits.filter(Boolean).join(' · ');
}

// Le rendu ne reconstruit les onglets que si quelque chose a changé : une infobulle ouverte ou un clic en cours ne sont pas perdus.
let tabsSig = '';
let lastActive = null;

function renderTabs(s) {
  const sp = s.spaces.find((x) => x.id === s.activeSpace);
  const sig = JSON.stringify([s.activeTab, s.tabs, sp ? sp.groups : null]);
  if (sig === tabsSig) return;
  tabsSig = sig;
  const tabs = $('tabs');
  const keep = tabs.scrollLeft;
  tabs.replaceChildren();
  let prev = null;
  const hasActive = s.tabs.some((t) => t.id === s.activeTab);
  s.tabs.forEach((t, i) => {
    // Séparateur entre deux groupes (et avant les outils communs).
    const key = t.global ? '__global' : t.group || '';
    if (prev !== null && key !== prev) tabs.append(el('span', 'sep'));
    prev = key;
    const active = t.id === s.activeTab;
    const b = el('div', 'tab' + (active ? ' active' : '') + (t.global ? ' global' : '') + (t.loaded ? '' : ' sleeping'));
    b.tabIndex = active || (!hasActive && i === 0) ? 0 : -1; // un seul arrêt de Tab pour toute la rangée ; les flèches font le reste
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(active));
    b.dataset.key = `tab-${t.id}`;
    const gname = t.group && sp ? (sp.groups.find((g) => g.id === t.group) || {}).name : '';
    b.title = tabTitle(t) + (gname ? ` · ${gname}` : '');
    b.setAttribute('aria-label', b.title);
    b.append(favicon(t.icon, t.letter, t.global ? '#7b8794' : t.color));
    if (t.delta > 0) b.append(el('span', 'badge', `+${t.delta}`));
    if (t.auth === 'login') b.append(el('span', 'mk warn', '🔑'));
    else if (t.draft) b.append(el('span', 'mk warn', '✎'));
    if (t.audible && !(t.delta > 0)) b.append(el('span', 'mk', '♪'));
    const x = el('button', 'close', '×');
    x.tabIndex = -1;
    x.title = 'Fermer';
    x.setAttribute('aria-label', 'Fermer l\'onglet');
    x.onclick = (e) => { e.stopPropagation(); window.junr.closeTab(t.id); };
    b.append(x);
    b.onclick = () => window.junr.selectTab(t.id);
    b.onkeydown = (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === b) { e.preventDefault(); window.junr.selectTab(t.id); }
      else if (e.key === 'Delete') { e.preventDefault(); window.junr.closeTab(t.id); }
      else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const all = [...tabs.querySelectorAll('.tab')];
        const at = all.indexOf(b);
        const to = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)));
        all[at].tabIndex = -1; all[to].tabIndex = 0; all[to].focus();
      }
    };
    b.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); window.junr.closeTab(t.id); } };
    b.oncontextmenu = (e) => { e.preventDefault(); window.junr.tabMenu(t.id); };
    tabs.append(b);
  });
  tabs.scrollLeft = keep;
  // L'onglet actif change (raccourci, Ctrl+K, signal) : on le ramène dans la rangée s'il est hors de vue.
  if (s.activeTab !== lastActive) { lastActive = s.activeTab; tabs.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }
}

/* ---------- Extensions épinglées ---------- */
let extSig = '';
function renderExtensions(s) {
  const sig = JSON.stringify(s.toolbar);
  if (sig === extSig) return;
  extSig = sig;
  const exts = $('exts');
  exts.replaceChildren();
  for (const x of s.toolbar) {
    const b = el('button', 'extbtn');
    b.title = x.name;
    if (x.icon) { const img = el('img'); img.src = x.icon; img.alt = ''; b.append(img); }
    else b.textContent = x.name.slice(0, 1).toUpperCase();
    b.onclick = () => window.junr.extAction(x.id, Math.round(b.getBoundingClientRect().right));
    b.oncontextmenu = (e) => { e.preventDefault(); window.junr.extContext(x.id, e.clientX, e.clientY); };
    exts.append(b);
  }
}

/* ---------- Messages calmes : dans la barre d'adresse, quelques secondes ---------- */
function renderNotice(s) {
  const n = $('notice');
  n.hidden = !s.notice;
  n.textContent = s.notice || '';
}

function render(s) {
  current = s;
  const focused = document.activeElement?.dataset?.key || null;
  const typing = document.activeElement === $('address');
  renderIdentity(s);
  renderTabs(s);
  renderExtensions(s);
  renderNotice(s);
  $('vitrine-pill').hidden = !s.vitrine;
  const activeTab = s.tabs.find((t) => t.id === s.activeTab);
  if (!typing) $('address').value = activeTab ? activeTab.url : '';
  renderAddress(activeTab ? activeTab.url : '');
  $('empty').classList.toggle('show', !activeTab);
  $('empty-text').textContent = s.emptyInGroup ? 'Aucun onglet dans ce groupe.' : 'Aucun onglet ouvert pour ce client.';
  $('empty-hint').textContent = s.emptyInGroup ? 'Ctrl+T en ouvre un ici, ou survolez l\'avatar pour revenir à « Tous ».' : 'Ctrl+T ouvre un onglet dans cet espace.';
  // Le rendu remplace les nœuds : on rend le focus clavier à l'élément équivalent.
  if (focused && document.activeElement === document.body) {
    const again = [...document.querySelectorAll('[data-key]')].find((n) => n.dataset.key === focused);
    if (again) again.focus({ preventScroll: true });
  }
}

/* ---------- Survol : une courte intention avant d'ouvrir, la fermeture est gérée par le processus principal ---------- */
function hover(button, kind) {
  let timer = null;
  const rect = () => { const r = button.getBoundingClientRect(); return { x: Math.round(r.left), right: Math.round(r.right) }; };
  button.addEventListener('mouseenter', () => { clearTimeout(timer); timer = setTimeout(() => window.junr.flyoutOpen(kind, rect()), 90); button.classList.add('open'); });
  button.addEventListener('mouseleave', () => { clearTimeout(timer); window.junr.flyoutLeave(kind); button.classList.remove('open'); });
  // Entrée ou Espace au clavier (detail === 0) : le volet s'ouvre et prend le focus ; Échap le referme. Au clic de souris, le survol l'a déjà ouvert.
  button.addEventListener('click', (e) => { clearTimeout(timer); window.junr.flyoutOpen(kind, rect(), e.detail === 0); });
}
hover($('avatar'), 'clients');
hover($('groupchip'), 'clients');
hover($('extmenu'), 'extensions');

$('settingsbtn').onclick = () => window.junr.openSettings();
$('newtab').onclick = () => window.junr.newTab();
$('fill').onclick = () => window.junr.fillPassword();
let typingTimer = null;
$('address').addEventListener('input', () => { clearTimeout(typingTimer); typingTimer = setTimeout(() => window.junr.addressInput($('address').value), 120); });
$('address').addEventListener('blur', () => { clearTimeout(typingTimer); window.junr.addressInput(''); });
$('addressbar').onsubmit = (e) => { e.preventDefault(); window.junr.navigate($('address').value); $('address').blur(); };
window.junr.onState(render);
window.junr.onFocusAddress(() => { $('address').focus(); $('address').select(); });
window.junr.getState().then(render);
// Les durées (« il y a 12 min ») restent justes sans rafale d'événements.
setInterval(() => { if (current && document.visibilityState === 'visible') render(current); }, 30000);
