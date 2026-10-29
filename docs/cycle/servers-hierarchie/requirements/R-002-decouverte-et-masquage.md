# R-002 Découverte automatique et masquage dans le noyau

**UAC (brief)** : tout s'affiche sauf le masqué · en cours en tête · identifiants, pas noms · aucune adresse venue de l'interface
**Dépend de** : R-001 · **Statut** : à faire

## Comportement attendu
L'observateur découvre toutes les cibles de chaque fournisseur configuré, les relève, et rend une vue à plat de toutes les apps non masquées, déploiements en cours d'abord.

## Contexte nécessaire
- Fichiers : `src/servers/observer.js` (`createObserver(deps)`), `src/servers/index.js` (câblage réel), `src/store.js` (clé `servers`), tests `test/unit/observer.test.js` (faux fournisseurs, horloge et minuteurs injectés).
- Entrées du noyau supprimées : `deps.clients`, `assign`, `browse`, le champ `clientId`, le plafond de 500 apps cochées (devenu plafond de 500 **cibles**). `observe` reste dans l'objet rendu mais devient interne (la découverte l'utilise ; les tests aussi) : il ajoute une cible `{ provider, ref, label, project }` à un catalogue mémoire.
- Nouveau : `sync()` appelle `provider.list(creds, { deadline })` de chaque fournisseur qui a ses secrets, remplace le catalogue de ses cibles (celles qui disparaissent sont retirées, y compris leurs relevés), mémorise ses `notes` ; en cas d'erreur, le catalogue précédent est gardé et l'erreur (assainie par `redact`) est mémorisée comme note du fournisseur. `sync` est appelé au début de chaque relevé `full`, à la pose du jeton, et quand le catalogue est vide.
- Identité : `targetId = sha1("<provider>:<JSON(ref)>")` tronqué à 12 caractères hexadécimaux ; une app (service) a l'identifiant `"<targetId>.<app.id>"`. Une cible sans `apps` rendues par `statuses` compte pour une seule app : `id = targetId`, `label = label de la cible`.
- Masquage : `store.servers.hidden` (tableau de chaînes, dédoublonné, plafonné à 2000). Clé = `"<provider>:" + ids du chemin joints par "/"` ; clé d'une app = clé de sa cible + `"/" + app.id`. Une cible/app est masquée si une clé de `hidden` est égale à l'un des préfixes de son chemin complet. `setHidden(key, hidden)` : refuse une clé inconnue du catalogue ou des relevés, ajoute ou retire, enregistre (`store.save()`), redessine. Une cible masquée n'est pas relevée.
- `view()` rend : `{ configured, items, mark, count, checkedAt, waitUntil, notes }` ; chaque item : `{ id, label, project, workspace, environment, state, detail, at, provider, providerLabel }` où `workspace/project/environment` sont les `name` des nœuds du chemin (chaînes vides sans chemin). Les items sont triés : états `deploying` d'abord (ordre du catalogue conservé), puis les autres dans l'ordre du catalogue. Tout le calcul de péremption (20 min), de `mark` et de `skipped` de l'ADR-6 est conservé, appliqué à la lecture de la cible puis à chacune de ses apps.
- `config()` rend `{ providers, tree, notes }` ; `tree` = `[{ key, id, name, kind, hidden, inherited, children: [...] }]` (espace › projet › environnement › service ; un service n'apparaît qu'après une première lecture de son environnement ; `hidden` = la clé est dans la liste, `inherited` = un ancêtre l'est).
- `urlOf(itemId)` rend l'adresse de l'app (produite par le fournisseur, jamais fournie par l'appelant) ou `null` ; seule une adresse `https://` est rendue.
- Au démarrage de `createObserver`, `delete store.servers.observed` (anciennes données abandonnées) ; `store.js` crée `data.servers.hidden ||= []`.
- Les relevés `new/live/full`, le budget, `skipped`, `triedAt`, `okAt` n'existe plus, le disjoncteur et le minuteur sont inchangés (cible = unité).

## Couches
1 migration & actions : `src/store.js` (valeur par défaut `hidden`). 2 logique : `observer.js`, `index.js`. 3 UI : absente. 4 intégration : R-003.

## Test cases
| Id | Couche | Comportement | Assertion |
|---|---|---|---|
| TC-2-1 | 2 | deux cibles découvertes | `view().items` les rend toutes sans geste |
| TC-2-2 | 2 | `setHidden` sur un projet | ses cibles ne sont plus relevées ni affichées ; réapparaissent quand on le retire |
| TC-2-3 | 2 | masquage d'un service précis | seul ce service disparaît de la vue |
| TC-2-4 | 2 | cible renommée mais même identifiant | reste masquée |
| TC-2-5 | 2 | déploiements en cours | triés avant les autres ; ordre du catalogue sinon |
| TC-2-6 | 2 | `list` en erreur au deuxième relevé | catalogue précédent gardé, note d'erreur sans secret |
| TC-2-7 | 2 | une cible disparaît du catalogue | ses items disparaissent |
| TC-2-8 | 2 | `urlOf` d'un item connu / inconnu / `javascript:` | url / `null` / `null` |
| TC-2-9 | 2 | `setHidden` d'une clé inconnue | refusé |
| TC-2-10 | 2 | `store.servers.observed` hérité | supprimé au démarrage, rien ne plante |
| TC-2-11 | 2 | état de plus de 20 min d'une app d'une cible | « Dernier relevé ancien », hors `mark` |
| TC-2-12 | 1 | `new Store` sans clé `hidden` | `hidden` vaut `[]` |

## Définition de terminé
- [ ] test cases verts · [ ] les tests existants de l'observateur qui ne concernent pas clients/assign/browse restent verts · [ ] rien d'ajouté hors de ce fichier
