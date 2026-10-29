# Observer les serveurs

Junr Browser affiche l'état des serveurs où sont déployés vos projets : **en ligne**, **en déploiement** ou **dernier déploiement échoué**. Un fournisseur est branché derrière un contrat commun ; Railway est le premier.

## Utilisation

1. **Réglages › Serveurs** : posez le jeton du fournisseur. Tout ce que le jeton peut lire s'affiche, sans rien cocher. La carte « Apps affichées » reprend la hiérarchie du fournisseur (pour Railway : espace de travail › projet › environnement › service) ; décochez un élément pour le masquer, avec tout ce qu'il contient. Le masquage suit l'identifiant, pas le nom : renommer un projet ne le fait pas réapparaître.
2. Une icône apparaît dans la barre dès qu'un jeton est posé. Son survol ouvre une liste défilante : les déploiements en cours d'abord (section « En cours de déploiement »), puis la hiérarchie du fournisseur, avec l'état de chaque app et l'heure du dernier relevé. Un clic sur une app ouvre sa page chez le fournisseur dans un onglet. La marque de l'icône suit le pire état : triangle = échec, anneau pointillé = déploiement en cours, plein = en ligne.
3. Le relevé se fait toutes les 30 s tant qu'une app est en déploiement (alors seules les apps en déploiement ou jamais relevées sont relevées), un relevé complet toutes les 5 min, et à la demande (« Actualiser »). La découverte (liste des espaces, projets et environnements) se refait à chaque relevé complet. Un relevé ne dépasse pas 45 s d'envoi ; si Railway répond 429 (trop de requêtes), l'envoi s'arrête et le prochain relevé attend le `Retry-After` (1 min par défaut). Trois délais ou erreurs serveur de suite coupent aussi l'envoi. Les apps non tentées gardent leur dernier état, avec son âge (« il y a 12 min ») ; au-delà de vingt minutes sans confirmation, l'état est présenté « Dernier relevé ancien » et l'icône l'ignore. Rien ne part sur le réseau sans jeton, ni quand l'application est fermée. Pas de webhook : l'application de bureau n'a pas d'adresse publique.

En mode vitrine, aucun nom ne sort : ni espace, ni projet, ni environnement, ni app. Les anciennes apps cochées à la main et leurs rattachements à un client sont abandonnés à la mise à jour.

## Jeton Railway

Railway ne propose **aucun jeton en lecture seule** : un jeton hérite des droits de la personne qui l'a créé, et un jeton d'espace de travail équivaut à l'administration de cet espace.

- Créez un **jeton de compte** (Railway › Account Settings › Tokens, sans espace de travail). Il faut un jeton de compte pour lister les espaces de travail.
- Créez-le depuis un compte dont le rôle dans l'espace est **le plus restreint possible** : c'est la seule limite que Railway applique réellement.
- Le jeton est chiffré par le coffre du système (DPAPI, Keychain, libsecret), jamais écrit en clair, jamais renvoyé à l'interface, jamais affiché dans une erreur. Sans coffre disponible, il n'est pas enregistré.

Ce que garantit **le code** : un seul chemin réseau (`gql()` dans `src/servers/railway.js`), vers `https://backboard.railway.com/graphql/v2`, qui n'envoie que des requêtes figées de lecture (`QUERIES` : l'arbre des projets, les espaces invités, les services d'un environnement). Aucun texte saisi n'est envoyé ; tout texte contenant `mutation` ou `subscription` est refusé avant l'envoi ; un test (`test/unit/railway.test.js`) échoue si une écriture apparaît dans le source.

Limites connues :

- Les requêtes GraphQL ont été écrites d'après la documentation publique et validées contre un faux serveur, **pas contre un compte Railway réel**. Elles sont toutes dans `QUERIES` ; à la première utilisation, si Railway répond par une erreur de schéma, le message s'affiche sur l'app (« Inconnu ») et le journal.
- Une cible relevée est un environnement : une requête rend tous ses services (100 par page, 10 pages au plus ; au-delà la cible le dit). Un service sans déploiement apparaît « Inconnu ».
- La liste du volet est limitée à 1000 lignes (déploiements en cours et échecs d'abord, une note donne le nombre de lignes non affichées) ; au plus 1000 services lus par environnement ; un environnement dont un déploiement dure plus de 30 min ne garde pas le rythme rapide de 30 s.
- Au plus 500 projets par espace de travail (la liste le signale en note) et 500 environnements. Les espaces où vous êtes invité sont lus aussi ; si cette lecture échoue, une note le dit et le reste s'affiche.
- Une requête par environnement et par relevé (plus les pages suivantes) : 12 requêtes par heure et par environnement au repos, 120 en déploiement. Le quota de l'API Railway dépend du plan (environ 1 000 requêtes par heure en Hobby, à confirmer) : au-delà d'environ 80 environnements, masquez ceux qui ne vous servent pas ou prévoyez un plan supérieur (un environnement masqué n'est pas relevé). Le quota est par jeton, donc partagé entre vos installations et vos outils. Quand Railway répond « trop de requêtes », le volet l'affiche (« Quota atteint, nouvel essai à… ») et rien ne part avant l'heure indiquée, même sur « Actualiser ».
- Au-delà du quota, les environnements sont relevés à tour de rôle et la plupart s'affichent « Dernier relevé ancien » ; de même si Railway met plus d'environ 1 s par requête avec 500 environnements (45 s de budget par relevé, 4 requêtes en parallèle).
- Un service sans déploiement ou supprimé reste « Inconnu » et n'est relevé qu'au relevé complet de 5 min.

## Journal

`servers.log` dans le dossier de données (remplacé par `servers.log.1` au-delà de 200 Ko) : une ligne par relevé qui compte des états inconnus (heure, étendue, nombre d'environnements, nombre d'états inconnus, durée). Jamais de jeton.

## Ajouter un fournisseur

Un fournisseur est un objet du contrat décrit en tête de `src/servers/providers.js` :

```js
{ id, label, secrets: [{ key, label }],
  list(creds, { deadline })  // { targets: [{ ref, path: [{ id, name, kind }] }], notes: [string] } ; le chemin (kind : workspace | project | environment) sert à ranger et à masquer
  statuses(creds, refs, { deadline }) // [{ state: 'online' | 'deploying' | 'failed' | 'unknown', detail, apps?: [{ id, name, state, detail, url? }], note?, backoffMs?, skipped? }] dans l'ordre de refs ; deadline en ms epoch (Date.now()) ; skipped : cible non tentée, son dernier état reste valable ; url : HTTPS seulement ; note : texte affiché dans les notes de la vue, à poser dès qu'une liste est tronquée
  validateRef?(ref)     // optionnel : lève si la référence d'une cible est inutilisable
}
```

1. Écrire `src/servers/<fournisseur>.js` (sans dépendance d'Electron, `fetch` injectable pour les tests).
2. L'enregistrer dans `get()` de `src/servers/index.js`.
3. Écrire `test/unit/<fournisseur>.test.js` contre un faux serveur, en reprenant les cas de `railway.test.js` (statuts, jeton refusé, panne, aucune écriture).

Ni le noyau (`observer.js`) ni l'interface ne changent.
