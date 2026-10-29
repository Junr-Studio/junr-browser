# Brief server-observer

*Phase 1 du cycle. Clôt par : l'utilisateur a tranché le périmètre.*

## Déclencheur
Non précisé par l'utilisateur (question ouverte, non bloquante). Fait établi : Junr Browser est organisé par client, et les projets de ces clients sont déployés sur des serveurs (Railway en premier) dont l'état ne se voit nulle part dans l'application.

## Problème
Quand on travaille sur un client, on ignore si ses serveurs sont en ligne, en cours de déploiement ou si le dernier déploiement a échoué. Pour le savoir, il faut quitter le travail en cours et aller lire le tableau de bord de chaque fournisseur, projet par projet. Le besoin vaut quel que soit le fournisseur ; Railway est le premier cas à couvrir.

## Qui, et à quel moment
Le développeur / exploitant qui jongle entre plusieurs clients dans Junr Browser : en plein travail, juste après un déploiement ou quand un client signale une panne, il veut savoir en un coup d'œil si un serveur est la cause.

## Contournement actuel
Ouvrir le tableau de bord du fournisseur (Railway : workspace, puis projet, puis app), éventuellement dans un onglet de l'outil du client. Coût : un aller-retour par projet, et aucun moyen de voir tous les serveurs ensemble. À égaler au minimum : voir l'état de chaque app sans quitter l'application.

## Succès observable
| Signal | Aujourd'hui | Attendu |
|---|---|---|
| Voir l'état de toutes les apps observées | un tableau de bord par projet | une seule liste, accessible au survol d'une icône de la barre |
| Repérer un dernier déploiement échoué | ouvrir le projet chez le fournisseur | statut « dernier déploiement échoué » lisible dans la liste |
| Fraîcheur d'un déploiement en cours | rafraîchir à la main | passage de « en déploiement » à « en ligne » ou « échec » sans action, en 30 s au plus |
| Ajouter un second fournisseur | sans objet | possible sans toucher à l'interface ni au modèle de statut |
| Écriture chez le fournisseur | sans objet | aucune requête d'écriture n'est jamais émise (vérifié par un test) |

## Périmètre
**Dedans**
- Un contrat fournisseur agnostique : un fournisseur fournit la hiérarchie à parcourir (ex. workspace > projet > app) et le statut d'une app parmi un jeu commun : en ligne, en déploiement, dernier déploiement échoué (plus « inconnu » si le fournisseur est injoignable).
- Premier fournisseur : Railway (workspaces > projets > apps).
- Parcours dans les Réglages pour choisir les apps à observer ; rattachement optionnel de chaque app à un client.
- Secrets saisis à la main dans les Réglages, chiffrés par le coffre du système (même mécanisme que le jeton du relais), jamais renvoyés à l'interface.
- Icône dans la barre, liste au survol, défilante (la liste peut être longue).
- Rafraîchissement : sondage toutes les 30 s tant qu'au moins une app est en transition, toutes les 5 min quand tout est stable ; relevé immédiat à la demande.
- **Lecture seule** : l'application n'émet que des requêtes de lecture.

**Dehors : explicitement**
- Webhooks et temps réel : décidé par l'utilisateur. Railway envoie ses webhooks vers une URL publique et l'application de bureau n'en a pas.
- Toute action sur les serveurs (redéployer, redémarrer, annuler, modifier) : le jeton ne doit servir qu'à lire.
- Alertes actives (Alt+J, notification système) : l'utilisateur a choisi l'icône avec liste au survol. *À confirmer.*
- Journaux, métriques, coûts, variables d'environnement : l'enjeu est le statut. *À confirmer.*
- Un autre fournisseur que Railway : seul le contrat doit le permettre.
- Observation hors application ouverte : aucune surveillance quand l'application est fermée.

## Options examinées
| Option | Ce que ça coûte | Ce que ça ferme | Retenue |
|---|---|---|---|
| A : icône dans la barre + liste au survol, sondage adaptatif | Un nouvel élément dans la barre unique (46 px), donc passage par la direction artistique ; un minuteur réseau en arrière-plan | Pas de signal actif quand on ne regarde pas l'icône | ✅ choix de l'utilisateur |
| B : section Réglages seule | Le plus simple | Il faut ouvrir les Réglages pour savoir | ❌ trop loin du contournement actuel |
| C : pastille par client dans le volet des clients + alerte Alt+J | Plus de surface UI et de tests ; mêle statut serveur et signaux d'outils | Lecture par client plutôt qu'en liste | ❌ non retenue par l'utilisateur |
| Webhook Railway via récepteur hébergé | Un serveur public à héberger, authentifier, déployer : seconde feature | Rien | ❌ écarté : « pas de webhook du tout » |
| Jeton de projet au lieu de jeton de compte/espace | Un jeton par projet, pas de parcours des workspaces | Le parcours workspaces > projets > apps voulu | ❌ le parcours demandé l'exige |
| Ne rien faire | Continuer à ouvrir le tableau de bord de chaque projet | Rien | ❌ coût récurrent par client |

## Contraintes non négociables
- **Le jeton ne sert qu'à lire.** Constat : Railway ne documente pas de jeton en lecture seule ; un jeton hérite des droits de la personne qui l'a créé, et un jeton d'espace de travail équivaut à l'administration de l'espace. La garantie doit donc venir en partie de l'application (voir question ouverte).
- Le jeton est chiffré au repos (coffre du système), n'apparaît jamais dans les journaux, le store en clair, ni les réponses envoyées à l'interface.
- Un jeton seul sert un seul fournisseur : jamais envoyé ailleurs que vers l'adresse de ce fournisseur, en HTTPS.
- Le statut est calculé et affiché localement ; rien n'est envoyé à Junr ni à un tiers.

## Questions ouvertes
- [x] **Jeton en lecture seule** *(tranché : garde dans le code + jeton du rôle le plus restreint)* : comment tient-on la garantie, sachant que Railway n'offre pas de portée lecture seule ? Pistes : (1) garde dans le code (requêtes figées et en liste blanche, aucune requête saisie par l'utilisateur, refus de tout ce qui n'est pas une requête de lecture, test qui échoue si une écriture apparaît) ; (2) en plus, un jeton créé depuis un compte ou un espace dont le rôle est le plus restreint possible. *(bloquant)*
- [ ] Déclencheur : qu'est-ce qui fait qu'on en parle maintenant ? *(non bloquant)*
- [ ] Contournement actuel : à confirmer tel que décrit ci-dessus. *(non bloquant)*
- [x] Hors-périmètre ci-dessus *(confirmé)* (alertes actives, journaux et métriques). *(non bloquant)*
- [ ] Une app « en échec » reste-t-elle « en échec » indéfiniment, ou est-elle ramenée à « en ligne » si l'ancienne version tourne encore ? À trancher en phase 2. *(non bloquant)*
