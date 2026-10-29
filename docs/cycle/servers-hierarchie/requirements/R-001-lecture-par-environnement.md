# R-001 Lecture Railway par environnement

**UAC (brief)** : toutes les apps lisibles, y compris des espaces invités · lecture économe et exacte · aucune écriture
**Dépend de** : (aucun) · **Statut** : à faire

## Comportement attendu
Le fournisseur Railway liste ses environnements lisibles (espaces de travail propres et invités) et rend, par environnement, tous ses services avec leur dernier déploiement, en un appel paginé par environnement.

## Contexte nécessaire
- Fichiers : `src/servers/providers.js` (contrat, commentaire en tête + `safeStatuses`), `src/servers/railway.js` (`createRailway`, `QUERIES` gelé, `gql()` seul chemin réseau, disjoncteur de `statuses`), tests `test/unit/railway.test.js`, `test/unit/providers.test.js` (faux `fetch` qui choisit sa réponse par un fragment du texte de la requête).
- Contrat v2 d'un fournisseur :
  ```
  list(creds, { deadline }) -> { targets: [{ ref, path: [{ id, name, kind }] }], notes: [string] }
  statuses(creds, refs, { deadline }) -> [{ state, detail, apps?: [{ id, name, state, detail, url }], backoffMs?, skipped? }]
  ```
  `kind` ∈ `workspace | project | environment`. `browse` disparaît du contrat et de `railway.js`. `safeStatuses` laisse passer `apps` (tableau borné à 500 entrées, chaque champ texte tronqué à 200 caractères, `url` gardée seulement si elle commence par `https://`).
- Requêtes (seules existantes, texte exact, aucune ne contient mutation ni subscription) :
  - `tree` : `query Tree { me { workspaces { id name projects(first: 500) { edges { node { id name deletedAt environments { edges { node { id name canAccess } } } } } } } } }`
  - `external` : `query External { externalWorkspaces { id name projects { id name deletedAt environments { edges { node { id name canAccess } } } } } }` (`projects` est ici une liste simple, pas une connexion)
  - `instances` : `query Instances($p: String!, $e: String!, $after: String) { environment(id: $e, projectId: $p) { id serviceInstances(first: 100, after: $after) { edges { node { serviceId serviceName latestDeployment { id status } } } pageInfo { hasNextPage endCursor } } } }`
- `list` : exécute `tree` (une erreur remonte, jeton refusé compris) puis `external` (une erreur ne casse pas : elle devient une note « Espaces invités non lus : <motif> »). Ignore les projets avec `deletedAt` non nul et les environnements dont `canAccess` est faux. Une cible par environnement : `ref = { projectId, environmentId }`, `path = [workspace, project, environment]`. Si un espace rend 500 projets, note « Liste tronquée aux 500 premiers projets de <espace> ».
- `statuses` : une cible = un environnement. Pagine `instances` (cent par page, dix pages au plus ; au-delà, état de la cible `unknown` avec détail « Plus de 1000 services »). Chaque service : `latestDeployment` nul → `unknown`, détail « Aucun déploiement » ; statut `SUCCESS` → `online` ; `BUILDING DEPLOYING INITIALIZING QUEUED WAITING NEEDS_APPROVAL` → `deploying` ; `FAILED CRASHED` → `failed` ; `REMOVED REMOVING SKIPPED` ou inconnu → `unknown` (détail = statut brut). `url = https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<environmentId>` (identifiants passés par `encodeURIComponent`). État de la cible = le pire des services (`failed` > `deploying` > `online` > `unknown`) ; sans service : `unknown`, détail « Aucun service ». `environment` nul : `unknown`, détail « Environnement introuvable ». Le disjoncteur à trois vitesses, `deadline`, `backoffMs`, `skipped`, 429 et le plafond de réponse existants restent inchangés (une cible remplace une app).
- ADR : `docs/cycle/servers-hierarchie/03-architecture.md` (ADR-7) ; contrats de sécurité de `docs/cycle/server-observer/03-architecture.md` (ADR-1 : lecture seule).

## Couches
1 migration & actions : absente (aucun schéma côté fournisseur).
2 logique : `providers.js`, `railway.js`. 3 UI : absente. 4 intégration : absente (R-002).

## Test cases
| Id | Couche | Comportement | Assertion |
|---|---|---|---|
| TC-1-1 | 2 | `list` avec deux espaces, un projet supprimé, un environnement inaccessible | une cible par environnement lisible, chemins corrects |
| TC-1-2 | 2 | `external` répond une erreur | cibles de `tree` rendues, note « Espaces invités non lus » |
| TC-1-3 | 2 | `external` rend un espace invité | ses environnements sont des cibles |
| TC-1-4 | 2 | 500 projets dans un espace | note de troncature |
| TC-1-5 | 2 | `statuses` d'un environnement à trois services (SUCCESS, FAILED, aucun déploiement) | `apps` à trois entrées avec états et url exacte, état de la cible `failed` |
| TC-1-6 | 2 | plus de cent services | deuxième page demandée avec `after`, toutes les apps rendues |
| TC-1-7 | 2 | statuts REMOVED / SKIPPED / inconnu | `unknown` avec le statut brut |
| TC-1-8 | 2 | `environment` nul | `unknown`, « Environnement introuvable » |
| TC-1-9 | 2 | source de `railway.js` | aucun mot mutation/subscription hors de la garde ; les trois requêtes commencent par `query` |
| TC-1-10 | 2 | `safeStatuses` avec une `url` en `javascript:` | l'url est retirée |

## Définition de terminé
- [ ] test cases verts · [ ] suite unitaire existante adaptée (plus de `browse`) · [ ] rien d'ajouté hors de ce fichier
