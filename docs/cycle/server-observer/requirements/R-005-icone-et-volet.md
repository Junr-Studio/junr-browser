# R-005 Icône dans la barre et volet au survol

**Story** : S-3 · **UAC couvertes** : UAC-3.2, 3.5, 3.8
**Dépend de** : R-003
**Statut** : vert

## Comportement attendu
Une icône de la barre, visible seulement si un jeton est posé, porte une marque d'état global ; son survol ouvre un volet défilant qui liste les apps par client.

## Contexte nécessaire
- `shell/index.html` : bouton `#extmenu` (SVG 18 px) à imiter ; ajouter `<button id="servers" aria-haspopup="true" aria-label="Serveurs" hidden>` avant lui. `shell/shell.js` : `hover($('servers'), 'servers')` ; rendu `renderServers(s)` appelé par `render(s)` (affiche/masque, pose `data-mark` = `s.servers.mark`). CSS dans `shell/shell.css`.
- `src/flyout.js` : `WIDTH.servers = 380` ; positionnement comme `extensions` (aligné à droite de l'icône). `shell/flyout.js` (240 lignes, rendu par `kind`) : nouveau rendu `servers` ; `shell/flyout.css`.
- `src/tabs.js` `snapshot()` : ajouter `servers: require('./servers/observer').view()` (objet en cache, sans requête).
- Volet : en-tête (titre, heure du dernier relevé, bouton « Actualiser » → geste `servers-refresh`), puis groupes par client (nom + pastille de couleur du client existante) et « Non rattachées » en dernier ; chaque ligne : nom, projet, statut en mot (« En ligne », « En déploiement », « Dernier déploiement échoué », « Inconnu ») ET en forme (pas seulement la couleur), heure du relevé. Zone défilante (hauteur max gérée par `flyout:size`). Vide : « Aucune app observée » + bouton vers Réglages › Serveurs (`open-settings` `servers`).
- La forme des marques suit les pastilles d'outils (README) : plein = en ligne, anneau pointillé = en déploiement, triangle = échec, tiret = inconnu.
- Direction artistique : réutiliser variables et classes de `common.css`/`flyout.css` ; aucune couleur en dur hors variables existantes.

## Couches
### 1 migration & actions
Absente.
### 2 logique
Absente.
### 3 UI
Fichiers ci-dessus.
### 4 intégration
`src/flyout.js` : action `servers-refresh` → `observer.refresh()` (garde ouvert, `keepOpen`).

## Test cases
| Id | UAC | Couche | Comportement | Assertion |
|---|---|---|---|---|
| TC-005-1 | UAC-3.5 | 3 | sans jeton | `#servers` caché |
| TC-005-2 | UAC-3.8 | 3 | items failed/deploying/online | marque `failed` > `deploying` > `online` |
| TC-005-3 | UAC-3.2 | 3 | volet ouvert avec 3 apps dont 1 rattachée | groupes « client » et « Non rattachées », statut en mot |
| TC-005-4 | UAC-3.5 | 3 | volet sans app | message et bouton vers les Réglages |
| TC-005-5 | UAC-3.2 | 3 | 60 apps | la zone défile (scrollHeight > clientHeight), volet ≤ hauteur de la fenêtre |

## Définition de terminé
- [ ] tous les test cases verts
- [ ] aucune régression sur la suite existante
- [ ] rien ajouté qui ne soit demandé ici
