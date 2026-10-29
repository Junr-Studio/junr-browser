# Architecture servers-hierarchie

*Phase 3a, palier ticket : un seul ADR. Le contexte existant est `src/servers/` (voir `docs/cycle/server-observer/03-architecture.md`, ADR-1 à ADR-6, toujours valables sauf ce qui suit).*

## Impact schéma
**Le schéma bouge : oui, additivement et sans migration.** `junr-data.json` (classe `Store`, `src/store.js`) :
- ajout de `servers.hidden: string[]` (clés de masquage, voir ADR-7) ;
- `servers.observed` (apps cochées, avec leur rattachement `clientId`) n'est plus lu ni écrit : l'observateur le supprime au démarrage. Aucune conversion : tout s'affiche à la place (décision du brief).
Réversible : une ancienne version ignore `hidden` et retrouverait une liste `observed` vide.

## ADR-7 Découverte automatique, lecture par environnement, masquage par chemin

**Contexte.** La sélection manuelle app par app (ADR-6 et brief 0.3.0) est inversée : tout ce que le jeton peut lire s'affiche, sauf ce qui est masqué. Railway range les choses en espace de travail › projet › environnement › service ; l'API sait rendre tous les services d'un environnement avec leur dernier déploiement en un appel.

**Décision.**
1. Le contrat fournisseur remplace `browse` par `list(creds, { deadline })` : il rend des **cibles** (une cible = ce qu'un fournisseur lit en un appel ; pour Railway, un environnement), chacune avec une `ref` opaque et un `path` d'identifiants `[{ id, name, kind }]` (espace, projet, environnement). `statuses(creds, refs, opts)` garde sa forme mais chaque résultat peut porter `apps: [{ id, name, state, detail, url }]` : les apps (services) de la cible.
2. Le noyau découvre au début de chaque relevé complet (et à la pose du jeton), garde le catalogue précédent si la découverte échoue (le motif s'affiche), et relève toutes les cibles non masquées. Les étendues `new`/`live`/`full`, le budget, le disjoncteur, `skipped`, `triedAt` et l'état périmé de l'ADR-6 s'appliquent aux **cibles**.
3. Masquage : `servers.hidden` contient des clés `fournisseur:id1/id2/…` (préfixes du chemin espace/projet/environnement, ou chemin complet jusqu'au service `…/idService`). Une app est masquée si un préfixe de son chemin l'est. Les identifiants, pas les noms : renommer chez Railway ne ressuscite rien.
4. L'ouverture d'une page Railway ne reçoit jamais d'adresse de l'interface : le volet envoie l'identifiant d'une ligne, le processus principal retrouve l'adresse produite par le fournisseur (HTTPS) dans sa propre mémoire.
5. Le rattachement à un client disparaît (`clients()` du noyau, `assign`, `clientId`).

**Options écartées.** Garder `statuses` par service et le produit cartésien service × environnement : une requête par couple, dont des couples qui n'existent pas. Stocker la liste des apps découvertes dans `junr-data.json` : elle se reconstruit en un relevé et périmerait.

**Conséquences.** Le coût par relevé passe de « une requête par app » à « une requête par environnement » (plus une par page de cent services). Le seuil de service de `docs/SERVERS.md` se relève d'autant. `browse`, `observe`, `unobserve`, `assign` quittent l'API publique du noyau (`observe` reste interne : la découverte s'en sert, les tests aussi).

## Contexts touchés
| Context | Existant / nouveau | Dossier |
|---|---|---|
| Observation des serveurs | existant | `src/servers/` |
| Barre, volet, Réglages | existant | `src/tabs.js`, `src/flyout.js`, `src/ipc.js`, `shell/` |

## Ce que cette architecture interdit
- Une adresse fournie par l'interface pour l'ouverture d'un onglet.
- Un mot propre à Railway dans le noyau ou l'interface (`workspace`, `project`, `environment` y sont des **genres de nœud** fournis par le fournisseur, pas des termes Railway).
- Une liste silencieusement tronquée : si le fournisseur atteint une limite, la vue le dit.
