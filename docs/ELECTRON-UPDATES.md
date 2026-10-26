# Procédure de mise à jour d'Electron

Electron embarque Chromium : chaque version stable de Chromium (environ toutes les 4 semaines) apporte des correctifs de sécurité qu'un navigateur ne peut pas ignorer. Une faille des API d'extensions entre sessions (CVE-2026-70602, [avis](https://advisories.gitlab.com/npm/electron/CVE-2026-70602/)) est corrigée dans 39.8.8, 40.9.0, 41.2.1 et 42.0.0-beta.3 et suivantes ; `npm run check:electron` refuse toute version plus ancienne.

## À chaque version stable

1. `npm run check:electron` — indique la version installée, la dernière stable et la dernière de la branche.
2. Mettre à jour : `npm install electron@<version> --save-dev` (même branche majeure pour un correctif ; nouvelle majeure : lire les *breaking changes* de la version).
3. `npm test` — doit rester entièrement vert (isolation, extensions, permissions, partage, veille).
4. `npm run phase0:probe` — remesure les API d'extensions exposées (`src/extensions/electron-api-surface.json`). Comparer avec la version précédente : une API apparue ou disparue change la compatibilité affichée à l'installation.
5. `npm run phase0` — remesure la compatibilité du corpus **avec le pont** (réseau requis) et relire `docs/phase0-report.md` ; `JUNR_NO_SHIM=1 npm run phase0` mesure l'Electron nu pour savoir si une API est devenue native (le pont la masquerait sinon). Un recul du taux ou une extension passée « à vérifier » signale une régression du pont.
5bis. En cas de régression d'une extension : `EXT_ID=<id> node scripts/debug-sw.js` affiche la pile et le code de l'exception de son service worker.
6. Lancer l'application, vérifier à la main : ouverture d'un client, popup d'une extension, demande de permission, page Réglages.
7. Livrer. Les extensions installées sont rechargées au démarrage ; aucune migration de données n'est nécessaire.

## Rappels de sécurité

- Les vues de pages web gardent `contextIsolation`, `sandbox` et `nodeIntegration: false` (contrôlé par le test « Sécurité des vues »).
- Ne jamais désactiver `webSecurity` ni activer `nodeIntegration` pour contourner un problème de compatibilité.
- Le pont d'API (`src/extensions/bridge/`) dépend du mécanisme de liaison des API de Chromium (redéfinition de `chrome` par proxy, préchargements `service-worker` et `frame`, `ServiceWorkerMain.ipc`). Ces points sont couverts par les sections « Pont d'API » de `npm test` : ne pas mettre à jour Electron sans les relancer.
- Une version majeure d'Electron non maintenue ne reçoit plus de correctifs : ne pas rester plus d'une majeure derrière.
