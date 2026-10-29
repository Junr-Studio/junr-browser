'use strict';
// Volets de la barre du haut : « clients » (au survol de l'avatar) et « extensions » (au survol de l'icône puzzle).
const act = (name, ...args) => window.junrFlyout.act(name, ...args);
let last = null;

/* ---------- Clients ---------- */
function toolStatus(r) {
  const parts = [];
  let cls = '';
  if (r.auth === 'login') { parts.push('connexion demandée'); cls = 'warn'; }
  else if (r.audible) { parts.push('son en cours'); cls = 'hot'; }
  else if (r.delta > 0) { parts.push(r.n !== null ? `+${r.delta}` : 'a bougé'); cls = 'hot'; }
  else if (r.state === 'never') parts.push('jamais ouvert');
  else if (r.state === 'sleep') parts.push(`en veille${r.lastActive ? ' · ' + ago(r.lastActive) : ''}`);
  else parts.push(r.n ? String(r.n) : 'à jour');
  if (r.draft) parts.push('✎');
  return { text: parts.join(' · '), cls };
}

function renderResume(s) {
  const r = s.resume;
  if (!r || r.expires <= Date.now()) return null;
  const box = el('div', 'resume');
  box.append(el('strong', '', `Absent depuis ${duration(r.absentMs)}`));
  const chips = el('div', 'chips');
  for (const it of r.items) {
    const label = it.kind === 'mark' ? `${it.name} +${it.n}` : it.kind === 'audio' ? `${it.name} · audio en cours` : `${it.name} · connexion demandée`;
    const c = el('button', 'chipb', label + (it.shown ? ' · affiché' : ''));
    c.onclick = () => act('resume-open', it.tabId);
    chips.append(c);
  }
  if (r.items.length) box.append(chips);
  if (r.sleeping) {
    const l = el('div', 'dim', `${r.sleeping} outil${r.sleeping > 1 ? 's' : ''} en veille : non vérifié${r.sleeping > 1 ? 's' : ''}`);
    l.title = 'Le compteur d\'un outil endormi est celui d\'avant votre départ.';
    box.append(l);
  }
  return box;
}

function groupRow(label, count, marks, { current, onclick, menu, hint }) {
  const b = el('button', 'grp' + (current ? ' current' : ''));
  if (current) b.setAttribute('aria-current', 'true');
  b.append(el('span', 'gn', label));
  if (marks > 0) b.append(el('span', 'marks', `+${marks}`));
  b.append(el('span', 'gc', String(count)));
  b.onclick = onclick;
  if (hint) b.title = hint;
  if (menu) b.oncontextmenu = (e) => { e.preventDefault(); menu(); };
  return b;
}

function groupList(sp) {
  const box = el('div', 'groups');
  if (sp.groups.length) {
    box.append(groupRow('Tous', sp.total, 0, { current: !sp.group, onclick: () => act('select-group', sp.id, null) }));
    for (const g of sp.groups) {
      box.append(groupRow(g.name, g.count, g.marks, {
        current: sp.group === g.id, onclick: () => act('select-group', sp.id, g.id), menu: () => act('group-menu', sp.id, g.id), hint: 'Clic droit : renommer ou supprimer le groupe',
      }));
    }
    if (sp.ungrouped.count > 0 || sp.group === '__none') {
      const r = groupRow('Sans groupe', sp.ungrouped.count, sp.ungrouped.marks, { current: sp.group === '__none', onclick: () => act('select-group', sp.id, '__none') });
      r.classList.add('none');
      box.append(r);
    }
  }
  const add = el('button', 'grp add', '+ Groupe');
  add.title = 'Créer un groupe d\'onglets pour ce client (ex. Administratif, Développement) · clic droit sur un onglet pour l\'y ranger';
  add.onclick = () => act('create-group', sp.id);
  box.append(add);
  return box;
}

function spaceBlock(sp, i, s) {
  const active = sp.id === s.activeSpace && s.zone === 'client';
  const asleep = sp.tools.length > 0 && sp.tools.every((r) => r.state !== 'live');
  const box = el('div', 'space' + (active ? ' active' : '') + (asleep && !active ? ' sleepy' : ''));
  box.style.setProperty('--c', sp.color);
  const head = el('button', 'head');
  head.append(el('span', 'glyph', sp.glyph), el('span', 'name', sp.name));
  if (sp.marks > 0) head.append(el('span', 'marks', `+${sp.marks}`));
  if (!active) {
    const dots = el('span', 'dots');
    sp.tools.slice(0, 6).forEach((r) => dots.append(dot(r, sp.color)));
    if (sp.tools.length > 6) dots.append(el('span', 'more', `+${sp.tools.length - 6}`));
    head.append(dots);
  }
  if (i < 9) head.append(el('span', 'key', `Ctrl+${i + 1}`));
  const watching = sp.tools.filter((r) => r.state === 'live').length;
  head.title = sp.hidden ? '' : `${sp.name} · ${watching} outil(s) éveillé(s) sur ${sp.tools.length}` + (sp.marks ? ` · ${sp.marks} à voir` : '');
  head.onclick = () => act('switch-space', sp.id);
  box.append(head);
  if (active) {
    const card = el('div', 'card');
    if (asleep) card.append(el('div', 'cold', `Froid · ${sp.tools.length} outil(s) à réveiller`));
    card.append(groupList(sp));
    box.append(card);
  }
  return box;
}

function communRow(r, s) {
  const b = el('button', 'tool' + (r.tabId === s.activeTab ? ' current' : ''));
  const st = toolStatus(r);
  b.append(dot(r, '#8795a6'), el('span', 'tn', r.name), el('span', 'ts ' + st.cls, st.text));
  if (r.tabId !== null) b.onclick = () => act('select-tab', r.tabId);
  else b.disabled = true;
  return b;
}

function renderClients(s, panel) {
  document.documentElement.style.setProperty('--accent', s.activeClient && s.zone === 'client' ? s.activeClient.color : '#5b6fd6');
  const brand = el('div', 'brandrow');
  brand.append(el('div', 'brand', 'Junr'));
  const v = el('button', s.vitrine ? 'vitrine-btn on' : 'vitrine-btn', s.vitrine ? 'Quitter la vitrine' : 'Vitrine');
  v.title = s.vitrine ? 'Réafficher les autres clients' : 'Mode vitrine : masque les autres clients pendant un partage d\'écran (Ctrl+Maj+H)';
  v.onclick = () => act('toggle-vitrine');
  brand.append(v);
  panel.append(brand);

  // Zone d'attention calme : prochain signal, client précédent, message.
  const notice = el('div', 'notice');
  if (s.notice) notice.append(el('span', 'line hot', s.notice));
  if (s.queueCount > 0) {
    const b = el('button', 'line hot', `Alt+J : prochain signal (${s.queueCount})`);
    b.onclick = () => act('next-signal');
    notice.append(b);
  }
  if (s.previous) {
    const b = el('button', 'line', `← ${s.zone === 'client' ? 'Vous étiez chez ' : 'Dernier client : '}${s.previous}`);
    b.title = 'Retour au client précédent (Ctrl+Tab)';
    b.onclick = () => act('previous-space');
    notice.append(b);
  }
  if (notice.children.length) panel.append(notice);
  const resume = renderResume(s);
  if (resume) panel.append(resume);

  panel.append(el('div', 'section-title', 'Clients'));
  const spaces = el('nav', 'spaces');
  s.spaces.forEach((sp, i) => spaces.append(spaceBlock(sp, i, s)));
  panel.append(spaces);

  if (s.communs.length) {
    const wrap = el('div', 'communs');
    const t = el('div', 'section-title', 'Communs ');
    t.append(el('span', 'dim', '· tous les clients'));
    wrap.append(t);
    for (const r of s.communs) wrap.append(communRow(r, s));
    panel.append(wrap);
  }

  const foot = el('div', 'foot');
  if (s.update) {
    const up = el('button', 'side-btn upd');
    up.append(el('span', '', `Mise à jour ${s.update.next} prête`), el('span', 'key', 'Redémarrer'));
    up.title = 'Installe la nouvelle version et rouvre Junr Browser. Sinon, elle s\'installe toute seule à la fermeture.';
    up.onclick = () => act('update-install');
    foot.append(up);
  }
  const pick = el('button', 'side-btn');
  pick.append(el('span', '', 'Aller à…'), el('span', 'key', 'Ctrl+K'));
  pick.onclick = () => act('pick-space');
  const set = el('button', 'side-btn');
  set.append(el('span', '', 'Réglages'), el('span', 'key', 'Ctrl+,'));
  set.onclick = () => act('open-settings');
  foot.append(pick, set);
  const stats = el('div', 'stats');
  const l1 = el('div');
  l1.append(el('strong', '', String(s.memMb)), document.createTextNode(` Mo · ${s.live} éveillés`));
  if (s.protectedAwake) l1.append(document.createTextNode(` (${s.protectedAwake} protégés)`));
  const cov = el('div', 'cov');
  const on = el('span', 'on'); on.style.setProperty('flex', String(s.coverage.watched));
  const off = el('span', 'off'); off.style.setProperty('flex', String(Math.max(0, s.coverage.total - s.coverage.watched)));
  cov.append(on, off);
  const l2 = el('div', '', `Surveillés : ${s.coverage.watched} outils sur ${s.coverage.total}`);
  l2.title = 'Les outils endormis ou jamais ouverts ne peuvent rien signaler tant qu\'ils ne sont pas chargés.';
  stats.append(l1, cov, l2, el('div', '', `Veille après ${Math.round(s.unloadAfterMs / 60000)} min hors client courant`));
  foot.append(stats);
  panel.append(foot);
}

/* ---------- Extensions : toutes, avec l'épingle ---------- */
function renderExtensions(s, panel) {
  panel.append(el('div', 'section-title', 'Extensions'));
  if (!s.extensions.length) {
    panel.append(el('div', 'empty-note', 'Aucune extension installée.'));
  }
  for (const x of s.extensions) {
    const row = el('div', 'extrow');
    const main = el('button', 'extmain');
    const ic = el('span', 'exticon');
    if (x.icon) { const img = el('img'); img.src = x.icon; img.alt = ''; ic.append(img); } else ic.textContent = x.name.slice(0, 1).toUpperCase();
    main.append(ic, el('span', 'extname', x.name));
    if (x.hasAction) { main.title = `Ouvrir ${x.name}`; main.onclick = () => act('ext-action', x.id); }
    else { main.disabled = true; main.title = 'Cette extension n\'a pas de bouton'; }
    main.oncontextmenu = (e) => { e.preventDefault(); act('ext-context', x.id, e.clientX, e.clientY); };
    row.append(main);
    if (x.hasAction) {
      const pin = el('button', 'pin' + (x.pinned ? ' on' : ''), '📌');
      pin.title = x.pinned ? 'Retirer de la barre' : 'Épingler dans la barre';
      pin.setAttribute('aria-pressed', String(!!x.pinned));
      pin.onclick = () => act('ext-pin', x.id, !x.pinned);
      row.append(pin);
    }
    panel.append(row);
  }
  const manage = el('button', 'side-btn');
  manage.append(el('span', '', 'Gérer les extensions'));
  manage.onclick = () => act('open-settings', 'extensions');
  panel.append(manage);
}

/* ---------- Serveurs : liste défilante, groupée par client ---------- */
function serverRow(it) {
  const row = el('div', 'srow');
  row.title = it.detail ? `${SERVER_STATE[it.state]} (${it.detail})` : SERVER_STATE[it.state];
  const top = el('div', 'stop');
  top.append(el('span', `sd ${it.state}`), el('span', 'sname', it.label || 'App masquée'), el('span', `sstate ${it.state}`, SERVER_STATE[it.state]));
  row.append(top, el('div', 'ssub', [it.project, ago(it.at) || 'jamais relevé'].filter(Boolean).join(' · ')));
  return row;
}

function renderServers(s, panel) {
  const v = s.servers || { items: [], checkedAt: 0 };
  const head = el('div', 'srv-head');
  head.append(el('div', 'section-title', 'Serveurs'));
  const waiting = v.waitUntil > Date.now() ? `Quota atteint, nouvel essai à ${new Date(v.waitUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '';
  const sub = el('span', 'srv-sub', waiting || (v.checkedAt ? `Relevé ${ago(v.checkedAt)}` : 'Pas encore relevé'));
  const refresh = el('button', 'chipb', 'Actualiser');
  refresh.title = 'Relever l\'état maintenant';
  refresh.onclick = () => act('servers-refresh');
  head.append(sub, refresh);
  panel.append(head);
  if (!v.items.length) panel.append(el('div', 'empty-note', 'Aucune app observée.'));
  else {
    // Clients dans l'ordre de la barre, puis les apps sans client.
    const order = (s.spaces || []).map((c) => c.name);
    const groups = new Map();
    for (const it of v.items) {
      const k = it.clientName || '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)));
    const list = el('div', 'srv-list');
    for (const k of keys) {
      list.append(el('div', 'section-title', k || 'Non rattachées'));
      for (const it of groups.get(k)) list.append(serverRow(it));
    }
    panel.append(list);
  }
  const manage = el('button', 'side-btn');
  manage.append(el('span', '', v.items.length ? 'Gérer les serveurs' : 'Choisir les apps à observer'));
  manage.onclick = () => act('open-settings', 'servers');
  panel.append(manage);
}

// Un clic ne doit pas perdre son bouton : pendant un appui, le rendu attend le relâchement.
let pressed = false;
let pending = null;
window.addEventListener('mousedown', () => { pressed = true; });
// Un appui que la souris abandonne (elle quitte le volet) ne doit pas figer le rendu.
window.addEventListener('blur', () => { pressed = false; });
document.documentElement.addEventListener('mouseleave', () => { pressed = false; if (pending) { const p = pending; pending = null; render(p); } });
window.addEventListener('mouseup', () => { pressed = false; setTimeout(() => { if (pending && !pressed) { const p = pending; pending = null; render(p); } }, 0); });

function render(p) {
  last = p;
  if (pressed) { pending = p; return; }
  const panel = document.getElementById('panel');
  const keep = document.querySelector('.srv-list')?.scrollTop || 0;
  panel.replaceChildren();
  panel.className = p.kind;
  if (p.kind === 'clients') renderClients(p.s, panel);
  else if (p.kind === 'servers') renderServers(p.s, panel);
  else renderExtensions(p.s, panel);
  // Un nouveau relevé redessine le volet : la liste garde sa position.
  const list = document.querySelector('.srv-list');
  if (list && keep) list.scrollTop = keep;
  // scrollHeight : la hauteur du contenu, pas celle (bornée par la vue) du volet affiché.
  window.junrFlyout.size(panel.scrollHeight + 10);
}

window.junrFlyout.onState(render);
document.documentElement.addEventListener('mouseenter', () => window.junrFlyout.hover(true));
document.documentElement.addEventListener('mouseleave', () => window.junrFlyout.hover(false));
// Les durées restent justes pendant que le volet reste ouvert.
setInterval(() => { if (last && document.visibilityState === 'visible') render(last); }, 30000);
