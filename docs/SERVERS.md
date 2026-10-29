# Observer les serveurs

Junr Browser affiche l'état des serveurs où sont déployés vos projets : **en ligne**, **en déploiement** ou **dernier déploiement échoué**. Un fournisseur est branché derrière un contrat commun ; Railway est le premier.

## Utilisation

1. **Réglages › Serveurs** : posez le jeton du fournisseur, puis « Parcourir et choisir les apps » (espace de travail, projet, apps) et cochez les apps à suivre. Chaque app peut être rattachée à un client.
2. Une icône apparaît dans la barre dès qu'un jeton est posé. Son survol ouvre une liste défilante, groupée par client, avec l'état de chaque app et l'heure du dernier relevé. La marque de l'icône suit le pire état : triangle = échec, anneau pointillé = déploiement en cours, plein = en ligne.
3. Le relevé se fait toutes les 30 s tant qu'une app est en déploiement (alors seules les apps en déploiement ou jamais relevées sont relevées), un relevé complet toutes les 5 min, et à la demande (« Actualiser »). Une app ajoutée est relevée seule, tout de suite. Un relevé ne dépasse pas 45 s d'envoi ; si Railway répond 429 (trop de requêtes), l'envoi s'arrête et le prochain relevé attend le `Retry-After` (1 min par défaut). Trois délais ou erreurs serveur de suite coupent aussi l'envoi. Les apps non tentées gardent leur dernier état, avec son âge (« il y a 12 min ») ; au-delà de vingt minutes sans confirmation, l'état est présenté « Dernier relevé ancien » et l'icône l'ignore. Rien ne part sur le réseau sans jeton ni app observée, ni quand l'application est fermée. Pas de webhook : l'application de bureau n'a pas d'adresse publique.

En mode vitrine, une app n'a plus ni nom ni projet sauf si elle est rattachée au client affiché.

## Jeton Railway

Railway ne propose **aucun jeton en lecture seule** : un jeton hérite des droits de la personne qui l'a créé, et un jeton d'espace de travail équivaut à l'administration de cet espace.

- Créez un **jeton de compte** (Railway › Account Settings › Tokens, sans espace de travail). Il faut un jeton de compte pour lister les espaces de travail.
- Créez-le depuis un compte dont le rôle dans l'espace est **le plus restreint possible** : c'est la seule limite que Railway applique réellement.
- Le jeton est chiffré par le coffre du système (DPAPI, Keychain, libsecret), jamais écrit en clair, jamais renvoyé à l'interface, jamais affiché dans une erreur. Sans coffre disponible, il n'est pas enregistré.

Ce que garantit **le code** : un seul chemin réseau (`gql()` dans `src/servers/railway.js`), vers `https://backboard.railway.com/graphql/v2`, qui n'envoie que trois requêtes figées de lecture (`QUERIES`). Aucun texte saisi n'est envoyé ; tout texte contenant `mutation` ou `subscription` est refusé avant l'envoi ; un test (`test/unit/railway.test.js`) échoue si une écriture apparaît dans le source.

Limites connues :

- Les requêtes GraphQL ont été écrites d'après la documentation publique et validées contre un faux serveur, **pas contre un compte Railway réel**. Elles sont toutes dans `QUERIES` ; à la première utilisation, si Railway répond par une erreur de schéma, le message s'affiche sur l'app (« Inconnu ») et le journal.
- Une app est un couple service × environnement. Un couple sans déploiement apparaît « Inconnu ».
- Au plus 200 projets par espace de travail (la liste le signale) et 500 apps observées.
- Une requête par app et par relevé : à 500 apps, 6 000 requêtes par heure au repos. Le quota de l'API Railway dépend du plan (environ 1 000 requêtes par heure en Hobby, à confirmer) : au-delà d'environ 80 apps (12 requêtes par heure et par app au repos, 120 par app en déploiement), prévoyez un plan supérieur ou observez moins d'apps. Les 500 apps acceptées sont une borne de stockage, pas un volume garanti. Le quota est par jeton, donc partagé entre vos installations et vos outils. Quand Railway répond « trop de requêtes », le volet l'affiche (« Quota atteint, nouvel essai à… ») et rien ne part avant l'heure indiquée, même sur « Actualiser ».
- Au-delà du quota, les apps sont relevées à tour de rôle (500 apps pour 100 requêtes/h : chacune toutes les 5 h environ) et la plupart s'affichent « Dernier relevé ancien » ; de même si Railway met plus d'environ 1 s par requête avec 500 apps (45 s de budget par relevé, 4 requêtes en parallèle).
- Un service sans déploiement ou supprimé reste « Inconnu » et n'est relevé qu'au relevé complet de 5 min.

## Journal

`servers.log` dans le dossier de données (remplacé par `servers.log.1` au-delà de 200 Ko) : une ligne par relevé qui compte des états inconnus (heure, étendue, nombre d'apps, nombre d'états inconnus, durée). Jamais de jeton.

## Ajouter un fournisseur

Un fournisseur est un objet du contrat décrit en tête de `src/servers/providers.js` :

```js
{ id, label, secrets: [{ key, label }],
  browse(creds, path)   // [{ id, name, app?: { ref, label, project }, truncated? }] ; sans `app`, le nœud se déroule
  statuses(creds, refs, { deadline }) // [{ state: 'online' | 'deploying' | 'failed' | 'unknown', detail, backoffMs?, skipped? }] dans l'ordre de refs ; deadline en ms epoch (Date.now()) ; skipped : app non tentée, son dernier état reste valable
  validateRef?(ref)     // optionnel : lève si la référence d'une app est inutilisable
}
```

1. Écrire `src/servers/<fournisseur>.js` (sans dépendance d'Electron, `fetch` injectable pour les tests).
2. L'enregistrer dans `get()` de `src/servers/index.js`.
3. Écrire `test/unit/<fournisseur>.test.js` contre un faux serveur, en reprenant les cas de `railway.test.js` (statuts, jeton refusé, panne, aucune écriture).

Ni le noyau (`observer.js`) ni l'interface ne changent.
