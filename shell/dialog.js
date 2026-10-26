'use strict';
const $ = (id) => document.getElementById(id);
let spec = null;
let shown = [];
let sel = 0;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function renderItems() {
  const q = $('filter').value;
  // Éléments « enrichis » (Ctrl+K) : filtrage par mots ; éléments simples : sous-chaîne dans le libellé.
  shown = spec.rich ? window.junrMatch.filter(spec.items, q).slice(0, 50)
    : spec.items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  sel = spec.noDefault && sel < 0 ? -1 : Math.min(sel, Math.max(0, shown.length - 1));
  const ul = $('items');
  ul.replaceChildren();
  if (!shown.length && q.trim()) { ul.append(el('li', 'empty', `Aucun client ou outil ne correspond à « ${q.trim()} »`)); return; }
  let section = null;
  shown.forEach((it, i) => {
    if (spec.rich && !q.trim()) {
      const s = it.recent ? 'Récents' : 'Clients';
      if (s !== section) { section = s; ul.append(el('li', 'section', s)); }
    }
    const li = el('li', i === sel ? 'sel' : '');
    if (it.title) li.title = it.title;
    if (it.glyph) {
      const g = el('span', 'glyph', it.glyph);
      g.style.background = it.color || '#999';
      li.append(g);
    } else {
      const dot = el('span', 'dot');
      dot.style.background = it.color || '#999';
      li.append(dot);
    }
    const main = el('span', 'main');
    if (it.client !== undefined) {
      const line = el('span', 'line');
      line.append(el('strong', '', it.client));
      if (it.tool) line.append(document.createTextNode(` › ${it.tool}`));
      for (const t of it.tags || []) line.append(el('span', 'tag' + (t.hot ? ' hot' : ''), t.text));
      main.append(line);
      if (it.sub) main.append(el('span', 'sub', it.sub));
    } else main.append(el('span', '', it.label));
    li.append(main, el('span', 'hint', it.hint || ''));
    li.onclick = () => window.junrDialog.answer(it.id);
    ul.append(li);
  });
  $('items').querySelector('li.sel')?.scrollIntoView({ block: 'nearest' });
}

const promptResult = (button) => ({ button, text: $('text').value, link: !$('linkbox').hidden && $('link').checked });

window.junrDialog.onShow((s) => {
  spec = s;
  $('box').classList.toggle('wide', !!s.rich);
  $('title').textContent = s.title || '';
  $('message').textContent = s.message || '';
  const picker = s.kind === 'picker';
  const prompt = s.kind === 'prompt';
  $('filter').hidden = !picker;
  $('items').hidden = !picker;
  $('text').hidden = !prompt;
  $('linkbox').hidden = !(prompt && s.checkbox);
  $('filter').value = '';
  $('filter').placeholder = s.placeholder || 'Chercher un client…';
  $('text').value = s.initial || '';
  $('text').placeholder = s.placeholder || '';
  if (s.checkbox) { $('link').checked = !!s.checkbox.checked; $('linklabel').textContent = s.checkbox.label; }
  $('hint').textContent = s.hint || '';
  sel = s.noDefault ? -1 : 0;
  const buttons = $('buttons');
  buttons.replaceChildren();
  for (const b of s.buttons || []) {
    const btn = el('button', b.style || '', b.label);
    btn.onclick = () => window.junrDialog.answer(prompt ? promptResult(b.id) : b.id);
    buttons.append(btn);
  }
  if (picker) { renderItems(); $('filter').focus(); }
  else if (prompt) { $('text').focus(); $('text').select(); }
  else buttons.querySelector('button.primary, button')?.focus();
});

$('filter').addEventListener('input', () => { sel = 0; renderItems(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { window.junrDialog.answer(null); return; }
  if (spec?.kind === 'prompt' && e.key === 'Enter') {
    e.preventDefault();
    if (!$('text').value.trim() && !spec.initial) return;
    window.junrDialog.answer(promptResult(e.ctrlKey ? (spec.ctrlEnter || 'next') : (spec.enter || 'note')));
    return;
  }
  if (spec?.kind !== 'picker') return;
  // Choix direct par un chiffre tant que le champ est vide (1 à 9 = récents ou clients selon le sélecteur, 0 = Commun).
  if (spec.digitPick && /^[0-9]$/.test(e.key) && !$('filter').value && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const it = spec.items.find((i) => i.key === e.key);
    if (it) { e.preventDefault(); window.junrDialog.answer(it.id); return; }
  }
  if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); renderItems(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); renderItems(); e.preventDefault(); }
  else if (e.key === 'Enter' && shown[sel]) window.junrDialog.answer(shown[sel].id);
  else if (e.key === 'Enter' && sel < 0 && shown.length === 1) window.junrDialog.answer(shown[0].id);
});
