# Architecture server-observer

*Phase 3a. Entrée : 02-prd.md. Sortie : la phase 4 n'a plus de choix structurant.*

## Impact schéma
**Le schéma bouge : oui, additivement.** Pas de base de données : le fichier `junr-data.json` (classe `Store`, `src/store.js`) gagne une clé `servers`, créée à vide au chargement comme `relay`, `passwords`, etc. Réversible : supprimer la clé n'affecte rien d'autre. Déployable avant le code : oui, un fichier sans la clé est complété par défaut.

| Clé | Changement | Réversible | Déployable avant le code |
|---|---|---|---|
| `data.servers = { secrets: { [providerId]: { [champ]: base64 chiffré } }, observed: [{ id, provider, ref, label, project, clientId }] }` | ajout | oui | oui |

## Contexts touchés
| Context | Existant / nouveau | Stories | Dossier |
|---|---|---|---|
| Observation des serveurs | nouveau | S-1 à S-5 | `src/servers/` |
| Barre, volets, Réglages | existant (étendu) | S-3 | `shell/`, `src/flyout.js`, `src/ipc.js`, `src/tabs.js` |

## Modèle de domaine
- **Statut** (`ServerState`) : `online`, `deploying`, `failed`, `unknown`. Jeu commun fermé ; tout statut fournisseur inconnu devient `unknown`.
- **App observée** : identifiant local, fournisseur, référence opaque propre au fournisseur (`ref`), libellé, projet (texte), client rattaché ou `null`.
- **Relevé** : `{ state, detail, at }`. Un relevé en échec est `unknown` avec le motif ; il remplace le précédent. Une app non tentée (« sautée ») garde son dernier état et son âge ; au-delà de vingt minutes sans confirmation, cet état est présenté « Dernier relevé ancien » et sort de la marque de l'icône (jamais de statut périmé présenté comme frais).
- **Rythme** : 30 s si une app est `deploying`, 5 min sinon, jamais de requête sans jeton ni app observée.

## Ports
| Port | Exprimé par | Implémenté par | Sens |
|---|---|---|---|
| Fournisseur : `{ id, label, secrets:[{key,label}], browse(creds, path), statuses(creds, refs, { deadline }), validateRef?(ref) }` (chaque résultat peut porter `backoffMs` et `skipped`) | `src/servers/providers.js` | `src/servers/railway.js` | adaptateur → noyau |
| Transport HTTP (`fetch` injectable) | argument de `createRailway({ fetch })` | `fetch` global ; faux serveur en test | noyau → réseau |

`browse(creds, path[])` renvoie des nœuds `{ id, name, app?: { ref, label, project }, truncated? }` : sans `app`, le nœud se déroule ; avec `app`, il se coche.

## Adaptateurs
| Adaptateur | Type | Port implémenté |
|---|---|---|
| `src/servers/railway.js` | sortant | Fournisseur |
| `src/servers/observer.js` (config, coffre, sondage, état) | noyau | utilise le registre |
| `src/ipc.js` : appels `servers.*` (pages internes seulement) | primaire | observer |
| `src/flyout.js` + `shell/flyout.js` : volet « servers » ; `shell/shell.js` : icône | primaire | observer (via le snapshot) |

## Litmus « one module = one agent context »
| Module | Tient en un contexte | Sinon, découpe retenue |
|---|---|---|
| providers.js (contrat, registre, statuts) | oui, ~55 lignes | |
| railway.js | oui, ~220 lignes | |
| observer.js | oui, ~200 lignes | |
| UI (réglages, volet, icône) | oui, par fichier | |

## ADR
### ADR-1 Lecture seule garantie dans le code, pas par le jeton
Railway ne propose aucun jeton limité à la lecture. Décision : un seul point d'envoi (`gql()` dans `railway.js`) qui n'accepte que des requêtes d'une table figée, refuse tout texte contenant `mutation` ou `subscription`, et ne vise que l'adresse officielle. Un test lit le source et échoue si une écriture y apparaît. Écarté : filtrer par nom d'opération côté réseau (contournable) ; faire confiance au rôle du jeton (non vérifiable).

### ADR-2 Pas de dépendance, pas de bibliothèque GraphQL
`fetch` global et quelques requêtes en texte suffisent ; une bibliothèque agrandirait ce qui peut émettre une écriture.

### ADR-3 Le noyau ne connaît pas Railway
`observer.js` ne contient aucun mot propre à Railway. Il manipule des `ref` opaques. Un second fournisseur s'ajoute par une ligne dans le registre.

### ADR-4 Les secrets ne quittent jamais le processus principal
Stockage chiffré (`src/secrets.js`, comme le jeton du relais). L'interface ne reçoit que « enregistré : oui/non » ; l'appel `servers.*` refuse tout émetteur qui n'est pas une page interne.

### ADR-5 Sondage dans le processus principal, un relevé à la fois
Un seul minuteur, réarmé après chaque relevé selon l'état ; un relevé en cours absorbe les demandes concurrentes. Le minuteur est `unref`.

### ADR-6 Rythme et étendue des relevés (ajoutée en phase 5, précise l'ADR-5)
Un relevé a une **étendue** : `new` (apps jamais relevées), `live` (en plus : celles en déploiement ; une app durablement inconnue attend le relevé complet) ou `full` (toutes). Au rythme rapide (30 s, une app est en déploiement) seul `live` part ; le relevé complet revient au plus tous les 5 min. Une app cochée est relevée seule. Une demande reçue pendant un relevé est rejouée juste après (trois tours au plus, puis reprise dans la seconde) au lieu d'être perdue ; une demande plus large que le relevé en cours (« Actualiser » pendant un relevé partiel) devient un relevé complet. L'envoi d'un relevé a un budget de 45 s (`deadline`, en ms depuis l'epoch, comparable à `Date.now()`), les apps tentées il y a le plus longtemps partent en premier (`triedAt`, qui ne bouge pas sur une app sautée ; à date égale, les apps dont la dernière réponse est une erreur passent après), et les fournisseurs sont relevés en parallèle. Le fournisseur coupe l'envoi sur 401, 403 et 429 (avec `backoffMs` tiré de `Retry-After`, 60 s par défaut), et après trois échecs de suite pour un délai ou une erreur 5xx ; une erreur propre à une requête (service supprimé, accès retiré) ne coupe jamais, sauf si aucune app n'a répondu après dix essais (schéma refusé partout) ; une app non tentée (budget dépassé, coupure souple) est « sautée » : son dernier état connu reste affiché, avec son âge ; pendant une attente demandée, aucun relevé ne part, même sur demande (l'attente est commune à tous les fournisseurs, à rendre propre à chacun avec le second ; un nouveau jeton la lève). L'heure du dernier relevé n'avance que si une app a été tentée. Un message GraphQL « Not Authorized » n'est pas traité comme un jeton refusé (il peut désigner un service supprimé) : un jeton révoqué répond en HTTP 401, sinon la règle des vingt minutes dégrade l'affichage. Pendant une attente de quota de plus de dix minutes, le minuteur se déclenche quand même toutes les cinq minutes (une attente plus courte n'est pas plafonnée : la reprise n'est pas retardée) (il redessine sans requête, pour que l'icône dégrade un état devenu ancien). Au démarrage à froid, une app sautée sans relevé attend le relevé suivant (5 min) : la reprendre au rythme rapide multiplierait par huit les requêtes d'un schéma refusé partout. Le journal ne garde que les relevés qui comptent des états inconnus.

Limite assumée : une requête par app et par relevé. Un relevé complet toutes les 5 min coûte 12 requêtes par heure et par app, et le rythme rapide 120 par heure et par app en déploiement : avec le quota supposé d'un compte Hobby (environ 1 000/h, à confirmer), le seuil est d'environ 80 apps (6 000 requêtes/h à 500 apps). Une requête par couple projet/environnement est la suite logique, à écrire contre un compte réel (voir `docs/SERVERS.md`).

### Changement hors périmètre accepté
`tabs.openInternal(page, section)` attend la fin du chargement d'une page interne neuve (5 s au plus) avant de lui envoyer la section demandée. Avant, le message partait trop tôt et la page s'ouvrait toujours sur sa première section ; le bouton « Gérer les serveurs » du volet en dépend. Sans effet sur les appels sans section.

## Ce que cette architecture interdit
- Une requête d'écriture : l'unique chemin réseau refuse tout texte non figé.
- Le jeton dans une réponse à l'interface, dans le fichier en clair ou dans un message d'erreur (les erreurs sont assainies avant d'être remontées).
- Du code propre à Railway dans `observer.js` ou dans l'interface.
- Un relevé périmé affiché comme frais : un échec écrase le statut en `unknown`, une app sautée affiche son âge, et un état de plus de vingt minutes est dégradé en « Dernier relevé ancien ».
- Du réseau sans jeton ni app observée.
