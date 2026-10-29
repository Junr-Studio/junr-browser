# Round 2, axe performance : vert

`view()` passe de 596 ms à 3-9 ms (5000 à 15000 lignes, 2000 clés masquées) et sa charge est bornée à environ 182 Ko.

Mineur traité : `config()` quadratique en nœuds × clés masquées (1,1 s au pire cumulé) ; `own` et `inherit` passent par l'ensemble mémoïsé.
Reportés : taille de l'arbre `config()` (651 Ko à 1,8 Mo), reconstruction du volet à chaque push, snapshot complet envoyé aux volets non serveurs.
