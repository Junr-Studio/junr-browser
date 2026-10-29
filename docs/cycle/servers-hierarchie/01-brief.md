# Brief servers-hierarchie

*Phase 1 du cycle (palier ticket : la phase 2 se replie ici). Fait suite à `docs/cycle/server-observer/`.*

## Déclencheur
Premier usage réel de la fonction livrée en 0.3.0 : il faut cocher chaque app une à une, des apps manquent dans la liste, et le volet range les apps par client alors que Railway les range autrement.

## Problème
Pour voir l'état de tous ses déploiements, l'utilisateur doit d'abord inventorier ses apps à la main, le résultat est incomplet sans qu'il sache pourquoi, la liste ne reprend pas la hiérarchie qu'il connaît chez Railway (espace de travail, projet, environnement, service), et un déploiement en cours se perd dans la liste.

## Succès observable
| Signal | Aujourd'hui | Attendu |
|---|---|---|
| Apps visibles après la pose du jeton | aucune tant qu'on n'a pas coché | toutes celles que le jeton peut lire, sans geste |
| Apps masquées | sans objet | seulement celles que l'utilisateur a décochées en Réglages |
| Rangement du volet | par client | espace de travail › projet › environnement › service, comme chez Railway |
| Déploiement en cours | mêlé aux autres | en tête du volet |
| Clic sur une app | rien | ouvre sa page Railway dans le navigateur |
| Espaces où l'on est invité | absents | présents |

## Périmètre
**Dedans**
- Découverte automatique de toutes les apps lisibles (espaces de travail de l'utilisateur et espaces où il est invité).
- Masquage en Réglages, à n'importe quel niveau de la hiérarchie (espace, projet, environnement, service).
- Volet groupé comme Railway, avec les déploiements en cours remontés en tête.
- Clic sur une app : ouverture de sa page Railway dans un onglet de l'espace des outils communs.
- Lecture par environnement (un appel rend tous ses services et leur dernier déploiement) : plus économe en quota et exacte (plus de couples service × environnement qui n'existent pas).

**Dehors : explicitement**
- Le rattachement d'une app à un client est **supprimé** (demande de l'utilisateur : la hiérarchie de Railway fait foi).
- Webhooks, actions sur les serveurs, alertes actives, journaux et métriques (inchangé).
- Un second fournisseur (le contrat reste prêt pour).

## Options examinées
| Option | Ce que ça coûte | Ce que ça ferme | Retenue |
|---|---|---|---|
| A : découvrir tout, masquer par exception | Tout est relevé par défaut ; le quota décide du seuil de service | La sélection d'apps une à une | ✅ demandé |
| B : garder la sélection et ajouter un bouton « tout cocher » | Reste un inventaire à entretenir à chaque nouvelle app | Rien | ❌ une nouvelle app resterait invisible |
| C : lire chaque service séparément (comme en 0.3.0) | Une requête par service × environnement, y compris pour des couples inexistants | Rien | ❌ coûteux et inexact ; l'API sait rendre tous les services d'un environnement d'un coup |
| Ne rien faire | Inventaire manuel, apps manquantes | Rien | ❌ |

## Décisions prises sans l'utilisateur (à corriger si fausses)
- L'onglet s'ouvre dans l'espace des **outils communs** : le compte Railway est celui de l'utilisateur, pas d'un client, donc une seule session de connexion.
- Les déploiements en cours (« en déploiement ») remontent en tête ; les échecs restent à leur place dans la hiérarchie.
- En mode vitrine, tout nom (espace, projet, environnement, service) est masqué : sans rattachement à un client, on ne sait plus lesquels afficher.
- Le masquage se range par identifiant : renommer un projet chez Railway ne le fait pas réapparaître.
- Les anciennes données (apps cochées, rattachements) sont abandonnées : tout s'affiche à la place.

## Contraintes non négociables
- Le jeton ne sert qu'à lire, reste chiffré, n'est jamais renvoyé à l'interface (inchangé).
- Seule une adresse produite par le fournisseur (HTTPS, hôte Railway) peut être ouverte : l'interface ne fournit jamais l'adresse.

## Questions ouvertes
- [ ] Le schéma exact de `serviceInstances` / `externalWorkspaces` n'a pu être vérifié que sur le code du CLI officiel de Railway, pas contre un compte réel. *(non bloquant, à valider au premier essai)*
- [ ] Une limite de l'API ou un quota peut encore tronquer la liste ; la liste doit alors le dire au lieu de se taire. *(non bloquant)*
