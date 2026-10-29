# Round 5 : synthèse

- **Design system** : Approuvé (voir designsystem.md).
- **Performance** : Approuvé. Mesures : 500 apps dont 3 en erreur = 6 000 requêtes/h, 497 en ligne (au round 4 : 497 coupées) ; 250 apps « Aucun déploiement » sans effet sur les autres ; plus aucune famine de 150 ms à 2 s ; schéma refusé partout = 156 requêtes/h. Mineurs : le motif d'erreur d'une app est affiché sur les apps saines non tentées par la coupure ; état périmé pendant une panne.
- **Sécurité** : Bloqué sur M1 : un état conservé pour une app sautée est exact ligne par ligne (l'âge s'affiche) mais l'icône de la barre et l'en-tête du volet ne le disent pas (« Relevé à l'instant », icône verte). Aucune fuite de jeton ni de détail ; aucun rejet de promesse non géré.
- **Scalabilité** : Approuvé avec deux majeurs : sur un 429 les apps non tentées perdaient leur rang (les 100 mêmes apps relevées à chaque fois, 400 jamais lues) ; même état périmé que la sécurité. Le bloquant du round 4 est levé (reproduit : 3 services supprimés sur 500 = 497 en ligne).
- **Architecture** : Bloqué, pour des tests seulement. Le reviewer a appliqué 14 mutations au code : le test C5 était vide (il passait toujours), la condition `answered === 0` du disjoncteur et la remise à zéro de `pending` n'étaient protégées par aucun test.

Correctifs du round 6 : l'état d'une app plus ancien que quinze minutes est présenté « Dernier relevé ancien » et sort de la marque de l'icône ; l'heure du dernier relevé n'avance que si une app a été tentée ; sur un 429 les apps restantes sont sautées (elles gardent leur rang) ; une app sautée sans relevé n'a pas d'âge et est reprise tout de suite ; le motif des apps non tentées par la coupure « aucune réponse » est neutre ; tests réécrits ou ajoutés pour chaque comportement.

Décision tracée : un message GraphQL « Not Authorized » n'est pas traité comme un jeton refusé, parce que Railway l'emploie vraisemblablement aussi pour un service supprimé ou hors périmètre ; le traiter comme systémique rouvrirait le bloquant du round 4. Un jeton révoqué doit répondre en HTTP 401 ; sinon la règle des états périmés dégrade l'affichage au bout de quinze minutes.
