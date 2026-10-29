# R-001 Contrat fournisseur et registre

**Story** : S-1 · **UAC couvertes** : UAC-1.1, UAC-1.2, UAC-1.3
**Dépend de** : (aucun)
**Statut** : vert

## Comportement attendu
Un registre expose les fournisseurs (id, nom, champs secrets) et normalise tout statut en `online | deploying | failed | unknown`.

## Contexte nécessaire
- Fichier : `src/servers/providers.js` (nouveau), CommonJS, `'use strict'`, commentaires en français comme `src/relay.js`.
- Contrat d'un fournisseur :
  ```
  { id, label, secrets: [{ key, label }],
    browse(creds, path: string[]) -> Promise<[{ id, name, app?: { ref, label, project }, truncated? }]>,
    statuses(creds, refs: object[]) -> Promise<Array<{ state, detail }>>  // même ordre que refs
  }
  ```
- Exports : `STATES`, `register(p)`, `get(id)`, `list()` (→ `[{ id, label, secrets }]`), `normalize(state)` (inconnu → `'unknown'`), `safeStatuses(provider, creds, refs)` qui ne lève jamais : sur erreur, renvoie `unknown` pour chaque ref avec `detail` = message assaini.
- Le registre contient Railway (R-002) enregistré par `observer.js`, pas par ce fichier.

## Couches
### 1 migration & actions
Absente : le schéma ne bouge pas dans ce requirement.
### 2 logique
`src/servers/providers.js` comme ci-dessus.
### 3 UI
Absente.
### 4 intégration
Absente (R-003).

## Test cases
| Id | UAC | Couche | Comportement | Assertion |
|---|---|---|---|---|
| TC-001-1 | UAC-1.1 | 2 | fournisseur de test enregistré | `list()` le contient avec nom et champs secrets, sans fonctions |
| TC-001-2 | UAC-1.2 | 2 | `normalize('WHATEVER')` | `'unknown'` |
| TC-001-3 | UAC-1.3 | 2 | `statuses` qui lève | `safeStatuses` renvoie `unknown` avec motif, ne lève pas |

## Définition de terminé
- [ ] tous les test cases verts
- [ ] aucune régression sur la suite existante
- [ ] rien ajouté qui ne soit demandé ici
