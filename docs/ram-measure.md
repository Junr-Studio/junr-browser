# Mesure de RAM — 5 clients × 8 onglets

Généré par `npm run measure:ram` le 2026-10-25T19:25:33.288Z — Electron 45.0.0 (Chromium 156.0.8078.48), win32 10.0.26300, 16 cœurs, 23 Go de RAM.

Mesure : mémoire privée des processus (privateBytes), sans les pages partagées, via `app.getAppMetrics()`.

| Étape | Onglets actifs | Processus | RAM totale (Mo) |
| --- | --- | --- | --- |
| Application seule (interface, sans onglet) | 0 | 5 | 321 |
| 40 onglets chargés (avant veille) | 40 | 44 | 2815 |
| Après mise en veille (1 client actif) | 8 | 12 | 795 |

- **Surcoût fixe d'Electron** (interface + processus Chromium sans aucun onglet) : **321 Mo**.
- **Gain de la mise en veille** : 2020 Mo (72 %) — 32 onglets endormis, 8 restent actifs.
- Chargements en échec : 0 sur 40.

## Détail par type de processus

- Avant : Browser ×1 (99 Mo), GPU ×1 (322 Mo), Utility ×1 (24 Mo), Tab ×41 (2371 Mo)
- Après : Browser ×1 (90 Mo), GPU ×1 (214 Mo), Utility ×1 (24 Mo), Tab ×9 (467 Mo)

## Pages mesurées

- https://en.wikipedia.org/wiki/Electron_(software)
- https://developer.mozilla.org/en-US/docs/Web/JavaScript
- https://example.com
- https://news.ycombinator.com
- https://www.iana.org/domains/reserved
- https://en.wikipedia.org/wiki/Chromium_(web_browser)
- https://developer.mozilla.org/en-US/docs/Web/CSS
- https://www.rfc-editor.org/rfc/rfc9110.html

> Pages publiques, plutôt légères : un vrai poste avec des outils SaaS (ERP, messagerie, tableaux de bord) consomme davantage par onglet, donc le gain de la mise en veille y est plus grand. Relancer avec `JUNR_MEASURE_URLS` pour mesurer les vrais outils.
