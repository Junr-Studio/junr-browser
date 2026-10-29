# R-003 Observateur : configuration, coffre, sondage

**Story** : S-3 (données), S-4, S-5 · **UAC couvertes** : UAC-3.3, 3.4, 3.6, 3.7, 4.1 à 4.5, 5.3, 5.4, 5.6
**Dépend de** : R-001, R-002
**Statut** : vert

## Comportement attendu
Le processus principal stocke les secrets chiffrés et les apps observées, relève leur statut au rythme adaptatif et expose un état prêt à afficher.

## Contexte nécessaire
- Fichier : `src/servers/observer.js`. Utilise `state.store` (`src/state.js`), `secrets` (`src/secrets.js`, `encrypt`/`decrypt`/`available`), `providers.register(createRailway())`.
- Données : `state.store.data.servers ||= { secrets: {}, observed: [] }` (clé ajoutée dans `Store` comme `data.relay`). `observed[i] = { id, provider, ref, label, project, clientId|null }`. Bornes : 500 apps.
- API : `config()` (fournisseurs + `hasSecret` par champ + `observed`, jamais de secret), `setSecret(provider, key, value|null)` (refus clair si `!(await secrets.available())`), `browse(provider, path)`, `observe(app)` (sans doublon sur `provider+JSON(ref)`), `unobserve(id)`, `assign(id, clientId|null)`, `refresh()` (un relevé à la fois, absorbe les demandes concurrentes), `start()` / `stop()`, `view()` → `{ configured, items:[{id,label,project,provider,providerLabel,clientId,clientName,state,detail,at}], mark: 'failed'|'deploying'|'online'|'none', count }`.
- Un client supprimé : `view()` traite un `clientId` introuvable comme `null`.
- Rythme : `nextDelay()` = 30000 si un item est `deploying`, sinon 300000 ; aucun relevé ni minuteur actif si pas de secret ou pas d'app. Après chaque relevé (réussi ou non) le minuteur est réarmé (`unref`). Changement de `view()` → `tabs.push()` (modules chargés paresseusement comme dans `updater.js`).
- Injection de test : `_setClock`, `_setFetch` non nécessaires ; les tests passent par `providers.register` d'un faux fournisseur.

## Couches
### 1 migration & actions
`src/store.js` : `data.servers ||= { secrets: {}, observed: [] }` à côté de `data.usage ||= {}`.
### 2 logique
`src/servers/observer.js`.
### 3 UI
Absente.
### 4 intégration
`main.js` : `observer.start()` après l'ouverture de la fenêtre (hors test sauf `JUNR_TEST`) ; `src/ipc.js` : appels `servers.config`, `servers.setSecret`, `servers.browse`, `servers.observe`, `servers.unobserve`, `servers.assign`, `servers.refresh` dans la table `admin` (déjà réservée aux pages internes) ; `src/flyout.js` : geste `servers-refresh`.

## Test cases
| Id | UAC | Couche | Comportement | Assertion |
|---|---|---|---|---|
| TC-003-1 | UAC-3.6 | 2 | observer deux fois la même app | une seule entrée |
| TC-003-2 | UAC-3.7 | 2 | `unobserve` | absente de `view()` et du prochain relevé |
| TC-003-3 | UAC-3.3/3.4 | 2 | rattacher puis supprimer le client | `clientName` puis `null` |
| TC-003-4 | UAC-4.1/4.2 | 2 | un item `deploying` / aucun | `nextDelay()` 30000 / 300000 |
| TC-003-5 | UAC-4.3 | 2 | deux `refresh()` simultanés | un seul appel au fournisseur |
| TC-003-6 | UAC-4.4 | 2 | sans jeton ou sans app | zéro appel, pas de minuteur |
| TC-003-7 | UAC-4.5 | 2 | relevé qui échoue | items `unknown`, minuteur réarmé à 5 min |
| TC-003-8 | UAC-5.3 | 2 | `setSecret` puis lecture du fichier | pas en clair ; `config()` sans secret |
| TC-003-9 | UAC-5.4 | 2 | coffre indisponible (simulé) | refus avec message clair |
| TC-003-10 | UAC-5.6 | 4 | appel `admin` depuis une vue non interne | refusé (comportement existant de `ipc.js`) |

## Définition de terminé
- [ ] tous les test cases verts
- [ ] couches parcourues dans l'ordre 1 → 4
- [ ] aucune régression sur la suite existante
- [ ] rien ajouté qui ne soit demandé ici
