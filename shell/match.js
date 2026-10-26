'use strict';
// Filtre de Ctrl+K : « ac co » → Acme › Compta. Chaque mot saisi doit être le début d'un mot distinct, dans l'ordre ;
// le premier peut aussi être les initiales du client (« gc » → Globex Corp). Module partagé par la page et les tests.
(function (root) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

  // item : { kind: 'space'|'tool', client, tool?, words?: string[] }
  function matches(item, tokens) {
    const w = item.words ? item.words.map(norm) : words(`${item.client || ''} ${item.tool || ''}`);
    const clientWords = words(item.client || '');
    let from = 0;
    for (let t = 0; t < tokens.length; t++) {
      let at = -1;
      for (let i = from; i < w.length; i++) if (w[i].startsWith(tokens[t])) { at = i; break; }
      if (at < 0 && t === 0 && tokens[t].length >= 2 && clientWords.length > 1 && clientWords.map((x) => x[0]).join('').startsWith(tokens[t])) at = clientWords.length - 1;
      if (at < 0) return false;
      from = at + 1;
    }
    return true;
  }

  function filter(items, query) {
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return items.filter((i) => i.recent || i.kind === 'space');
    const hit = items.filter((i) => matches(i, tokens));
    // Stable : un seul mot qui désigne un client → ses lignes de client d'abord ; deux mots ou plus → les outils d'abord.
    const rank = (i) => (tokens.length === 1 ? (i.kind === 'space' ? 0 : 1) : (i.kind === 'tool' ? 0 : 1));
    return hit.map((i, n) => ({ i, n })).sort((a, b) => rank(a.i) - rank(b.i) || a.n - b.n).map((x) => x.i);
  }

  const api = { norm, words, matches, filter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.junrMatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
