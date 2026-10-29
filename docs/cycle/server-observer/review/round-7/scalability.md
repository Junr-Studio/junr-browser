# Round 7 : scalabilité

**Verdict : Approuvé.** Aucun bloquant ni majeur, aucune régression. Simulations (horloge virtuelle, 500 apps, 4 requêtes en parallèle, budget 45 s) :
- quota de 100 requêtes/h : 104 requêtes/h, les 500 apps lues après environ 4 h, la requête qui prend le 429 garde son état et son rang ;
- `Retry-After` d'une heure sur 3 h : 12 requêtes en tout, zéro pendant les attentes, 36 redessins du minuteur (un toutes les 5 min), pas de boucle ;
- péremption à vingt minutes : aucune dégradation à tort jusqu'à 1 s de latence (marge de 2,7 min), visible au-delà d'environ 1,1 s (documenté) ;
- 3 services supprimés sur 500 : 497 en ligne ; 4 cassées + 20 saines : 20 en ligne ; 401 : 48 requêtes/h ; panne 5xx : 72 requêtes/h ; schéma refusé partout : 156 requêtes/h.

Mineurs (dette tracée)
- Un recul d'horloge de la moindre amplitude dégrade toute la flotte (`t < r.at` sans tolérance) : tolérance d'une minute à envisager.
- Un 401/403 ne conserve pas l'état des (au plus 4) requêtes en vol : ajouter `denied` à la condition `skipped` (une ligne, non prioritaire).
- Un `Retry-After` court retarde la fin d'un relevé complet jusqu'au tick suivant (informatif).
- M2, M5 et E1 du round 6 restent documentés et non retenus ; leur coût est borné.
