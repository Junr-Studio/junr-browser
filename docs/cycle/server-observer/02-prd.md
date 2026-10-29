# PRD server-observer

*Phase 2. Entrée : 01-brief.md. Sortie : stories + UAC testables.*

## Problème (repris du brief, une phrase)
On ignore, depuis Junr Browser, si les serveurs des projets d'un client sont en ligne, en déploiement ou si leur dernier déploiement a échoué.

## Succès observable
| Signal | Aujourd'hui | Attendu | Couvert par |
|---|---|---|---|
| Voir l'état de toutes les apps observées | un tableau de bord par projet | une liste au survol d'une icône de la barre | S-3 |
| Repérer un dernier déploiement échoué | ouvrir le projet chez le fournisseur | statut « Dernier déploiement échoué » dans la liste | S-2, S-3 |
| Fraîcheur d'un déploiement en cours | rafraîchir à la main | transition visible sans action, 30 s au plus | S-4 |
| Ajouter un second fournisseur | sans objet | sans toucher au modèle de statut ni à l'interface | S-1 |
| Aucune écriture chez le fournisseur | sans objet | aucune requête d'écriture émise, vérifié par test | S-5 |

## Non-objectifs
- Webhooks, temps réel serveur *(décidé : l'application de bureau n'a pas d'URL publique)*.
- Toute action sur les serveurs : redéployer, redémarrer, annuler *(le jeton ne sert qu'à lire)*.
- Alertes actives (Alt+J, notification système) *(l'affichage choisi est l'icône avec liste)*.
- Journaux, métriques, coûts, variables d'environnement *(l'enjeu est le statut)*.
- Un second fournisseur *(seul le contrat doit le permettre)*.
- Surveillance application fermée.
- Pagination au-delà de 200 projets par espace de travail, 500 apps observées *(bornes écrites, voir UAC-2.5 ; 500 est une borne de stockage, pas un volume garanti : le quota de l'API fixe un seuil de service d'environ 80 apps, voir ADR-6)*.

---

## S-1 Contrat fournisseur agnostique
**Priorité** : must
**En tant que** développeur de Junr Browser, **je peux** brancher un fournisseur en déclarant ses champs secrets, son parcours (groupes puis apps) et sa lecture de statut, **pour** observer un nouveau fournisseur sans toucher à l'interface ni au modèle de statut.

### UAC
- **UAC-1.1** : Given un fournisseur de test enregistré / When on liste les fournisseurs / Then il apparaît avec son nom et ses champs secrets.
- **UAC-1.2** : Given un fournisseur qui renvoie un statut hors du jeu commun / When le statut est lu / Then l'app est « inconnu » avec le détail brut, jamais une erreur.
- **UAC-1.3** *(panne)* : Given un fournisseur injoignable / When le statut est lu / Then l'app passe « inconnu » avec la raison, les autres fournisseurs ne sont pas affectés.

### Écarté sur cette story
- Chargement dynamique de fournisseurs externes (le registre est interne).

---

## S-2 Statut Railway
**Priorité** : must
**En tant que** développeur, **je peux** lire le statut d'une app Railway, **pour** savoir si elle est en ligne, en déploiement ou si son dernier déploiement a échoué.

### UAC
- **UAC-2.1** : Given le dernier déploiement d'une app en SUCCESS / When le statut est lu / Then « En ligne ».
- **UAC-2.2** : Given le dernier déploiement en BUILDING, DEPLOYING, INITIALIZING, QUEUED, WAITING ou NEEDS_APPROVAL / When le statut est lu / Then « En déploiement ».
- **UAC-2.3** : Given le dernier déploiement en FAILED ou CRASHED / When le statut est lu / Then « Dernier déploiement échoué ».
- **UAC-2.4** : Given un déploiement REMOVED, REMOVING ou SKIPPED en tête de liste / When le statut est lu / Then il est ignoré et le suivant décide ; sans autre déploiement : « inconnu ».
- **UAC-2.5** *(volume)* : Given plus de 200 projets dans un espace de travail / When on parcourt / Then les 200 premiers sont listés et la liste dit qu'elle est tronquée.
- **UAC-2.6** *(droits)* : Given un jeton refusé (401/403) / When on lit ou parcourt / Then l'erreur dit « jeton refusé » sans jamais afficher le jeton.
- **UAC-2.7** *(panne)* : Given Railway répond par une erreur GraphQL ou réseau / When le statut est lu / Then l'app est « inconnu » avec le motif ; le dernier statut connu n'est pas conservé comme s'il était frais.

### Écarté sur cette story
- Distinguer « crash en boucle » de « échec de build » : un seul statut « échoué ».

---

## S-3 Choisir et voir les apps observées
**Priorité** : must
**En tant que** développeur, **je peux** choisir dans les Réglages les apps à observer et les voir au survol d'une icône de la barre, **pour** connaître l'état de mes serveurs sans quitter mon travail.

### UAC
- **UAC-3.1** : Given un jeton Railway enregistré / When j'ouvre Réglages › Serveurs et déroule espace de travail puis projet / Then je vois ses apps et je peux en cocher.
- **UAC-3.2** : Given des apps observées / When je survole l'icône de la barre / Then une liste défilante affiche, par app, le nom, le projet, le statut en mot et en forme, l'heure du dernier relevé, et le client rattaché le cas échéant.
- **UAC-3.3** : Given une app observée / When je la rattache à un client / Then elle s'affiche sous ce client ; sans rattachement elle est sous « Non rattachées ».
- **UAC-3.4** : Given un client supprimé / When la liste s'affiche / Then ses apps passent en « Non rattachées » sans erreur.
- **UAC-3.5** *(vide)* : Given aucune app observée / When je survole l'icône / Then un message dit comment en ajouter, avec accès aux Réglages. Sans jeton, l'icône n'est pas affichée.
- **UAC-3.6** *(doublon)* : Given une app déjà observée / When je la coche de nouveau / Then elle n'est pas dupliquée.
- **UAC-3.7** : Given une app observée / When je la décoche / Then elle disparaît de la liste et du sondage.
- **UAC-3.8** : Given au moins une app échouée / When je regarde la barre / Then l'icône porte la marque « échec » ; en déploiement sans échec : marque « en cours » ; sinon marque neutre.

### Écarté sur cette story
- Ouvrir le tableau de bord du fournisseur depuis la liste.

---

## S-4 Rafraîchissement adaptatif
**Priorité** : must
**En tant que** développeur, **je veux** que le statut se mette à jour seul, **pour** voir la fin d'un déploiement sans action.

### UAC
- **UAC-4.1** : Given au moins une app « En déploiement » / When le délai passe / Then le prochain relevé a lieu dans 30 s.
- **UAC-4.2** : Given aucune app en déploiement / When le délai passe / Then le prochain relevé a lieu dans 5 min.
- **UAC-4.3** : Given une liste ouverte / When je clique « Actualiser » / Then un relevé a lieu immédiatement, sans cumuler deux relevés simultanés.
- **UAC-4.4** *(vide)* : Given aucune app observée ou aucun jeton / When le temps passe / Then aucune requête réseau n'est émise.
- **UAC-4.5** *(panne)* : Given un relevé qui échoue / When l'échec survient / Then le sondage continue au rythme normal, sans boucle serrée.

---

## S-5 Jeton en lecture seule, chiffré
**Priorité** : must
**En tant que** développeur, **je veux** que le jeton ne puisse servir qu'à lire et ne fuite jamais, **pour** limiter ce qu'une erreur ou une compromission permet.

### UAC
- **UAC-5.1** : Given tout appel réseau du fournisseur Railway / When il est émis / Then c'est une requête de lecture d'une liste figée, vers l'adresse officielle en HTTPS ; une requête contenant `mutation` ou `subscription` est refusée avant envoi.
- **UAC-5.2** : Given le code source du fournisseur / When la suite de tests tourne / Then elle échoue si le mot `mutation` ou `subscription` apparaît dans une requête.
- **UAC-5.3** : Given un jeton enregistré / When on lit le fichier de données / Then le jeton n'y figure pas en clair ; l'interface ne reçoit que « jeton enregistré: oui/non ».
- **UAC-5.4** *(coffre indisponible)* : Given le coffre du système indisponible / When j'enregistre un jeton / Then l'enregistrement est refusé avec un message clair.
- **UAC-5.5** : Given une erreur du fournisseur / When elle est journalisée ou affichée / Then elle ne contient pas le jeton.
- **UAC-5.6** : Given l'interface web d'un site (pas une page interne) / When elle appelle l'API serveurs / Then l'appel est refusé.

---

## Dépendances externes
- API GraphQL publique de Railway (`backboard.railway.com/graphql/v2`), jeton de compte ou d'espace de travail posé à la main.
- Coffre de chiffrement du système (`safeStorage`).

## Questions ouvertes
- [x] Une app échouée reste-t-elle « échouée » ? *Tranché : oui, tant qu'un déploiement plus récent n'a pas réussi (UAC-2.3/2.4).*
- [ ] Le quota réel de l'API Railway (supposé : environ 1 000 requêtes/h en Hobby) et les en-têtes de limite de débit n'ont pas été vérifiés, ni la requête par couple projet/environnement qui ramènerait le coût de N à P. *(non bloquant, premier essai réel)*
- [ ] Les requêtes GraphQL exactes n'ont pas pu être vérifiées contre un jeton réel. Elles sont isolées dans un fichier et couvertes par un faux serveur. *(non bloquant, à valider à la première utilisation réelle)*
