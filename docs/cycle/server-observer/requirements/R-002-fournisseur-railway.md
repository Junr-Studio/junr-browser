# R-002 Fournisseur Railway en lecture seule

**Story** : S-2, S-5 · **UAC couvertes** : UAC-2.1 à 2.7, UAC-5.1, UAC-5.2, UAC-5.5
**Dépend de** : R-001
**Statut** : vert

## Comportement attendu
Le fournisseur Railway parcourt espaces de travail → projets → apps et lit le statut du dernier déploiement, en n'émettant que des requêtes de lecture figées.

## Contexte nécessaire
- Fichier : `src/servers/railway.js`, export `createRailway({ fetch = globalThis.fetch, endpoint = ENDPOINT })` → fournisseur au contrat de R-001, plus `ENDPOINT = 'https://backboard.railway.com/graphql/v2'` et `QUERIES` (objet gelé).
- Auth : `Authorization: Bearer <jeton>`, secret `token` (jeton de compte ou d'espace de travail).
- `gql(name, variables)` : seul chemin réseau. Refuse un nom absent de `QUERIES`, un texte qui contient `/\b(mutation|subscription)\b/i`, ou un `endpoint` non HTTPS (sauf `127.0.0.1`/`localhost`, pour le faux serveur de test). Expire à 20 s (`AbortSignal.timeout`). 401/403 → `Error('Railway : jeton refusé')`. Erreurs GraphQL → `Error('Railway : <1er message>')`. Aucun message ne contient le jeton (assaini).
- Requêtes (seules existantes) :
  - `workspaces` : `query { me { workspaces { id name } } }`. Si `me` échoue (jeton d'espace de travail) : message clair demandant un jeton de compte.
  - `projects` : `query($w:String!){ projects(workspaceId:$w, first:200){ edges{ node{ id name environments{edges{node{id name}}} services{edges{node{id name}}} } } } }`
  - `deployments` : `query($p:String!,$e:String!,$s:String!){ deployments(first:5, input:{projectId:$p, environmentId:$e, serviceId:$s}){ edges{ node{ id status createdAt } } } }`
- `browse(creds, [])` → espaces de travail ; `browse(creds, [w])` → projets (nœud `truncated:true` ajouté si 200 reçus) ; `browse(creds, [w, p])` → apps = service × environnement, `app.ref = { projectId, environmentId, serviceId }`, `label = "service (environnement)"`, `project = nom du projet`.
- `statuses(creds, refs)` : une requête `deployments` par ref, 4 en parallèle au plus. Correspondance : SUCCESS → `online` ; BUILDING, DEPLOYING, INITIALIZING, QUEUED, WAITING, NEEDS_APPROVAL → `deploying` ; FAILED, CRASHED → `failed` ; REMOVED, REMOVING, SKIPPED ignorés (le suivant décide) ; rien d'autre → `unknown`. `detail` = statut brut.
- Décision d'archi : ADR-1 (lecture seule dans le code).

## Couches
### 1 migration & actions
Absente : pas de schéma.
### 2 logique
`src/servers/railway.js`.
### 3 UI
Absente.
### 4 intégration
Absente (R-003).

## Test cases
| Id | UAC | Couche | Comportement | Assertion |
|---|---|---|---|---|
| TC-002-1 | UAC-2.1 | 2 | faux serveur : SUCCESS | `online` |
| TC-002-2 | UAC-2.2 | 2 | BUILDING, DEPLOYING, QUEUED… | `deploying` |
| TC-002-3 | UAC-2.3 | 2 | FAILED, CRASHED | `failed` |
| TC-002-4 | UAC-2.4 | 2 | [REMOVED, SUCCESS] ; [SKIPPED] seul | `online` ; `unknown` |
| TC-002-5 | UAC-2.5 | 2 | 200 projets reçus | dernier nœud `truncated` |
| TC-002-6 | UAC-2.6 | 2 | HTTP 401 | erreur « jeton refusé », sans le jeton |
| TC-002-7 | UAC-2.7 | 2 | erreur GraphQL / réseau | `statuses` → `unknown` + motif |
| TC-002-8 | UAC-5.1 | 2 | `gql` avec nom inconnu / texte `mutation` / endpoint http distant | refusé avant tout envoi (le faux fetch n'est pas appelé) |
| TC-002-9 | UAC-5.2 | 2 | lecture du source de `railway.js` | aucun `mutation` ni `subscription` hors de la garde |
| TC-002-10 | UAC-5.5 | 2 | réponse dont le message contient le jeton | le message remonté ne le contient pas |

## Définition de terminé
- [ ] tous les test cases verts
- [ ] aucune régression sur la suite existante
- [ ] rien ajouté qui ne soit demandé ici
