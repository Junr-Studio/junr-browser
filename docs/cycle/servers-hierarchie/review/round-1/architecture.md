# Round 1, axe architecture : rouge

Aucun bloquant. Deux majeurs introduits par le cycle.

- M1 : troncature silencieuse. `railway.js` lit jusqu'à 1000 services, `cleanApps` en coupe 500 sans le dire, et `view()` n'affiche jamais le détail « Plus de 1000 services ».
- M2 : le volet reconstruit la hiérarchie par contiguïté de noms ; l'ordre du catalogue ne garantit pas que les items d'un projet soient contigus. Le noyau doit trier par chemin d'ids.
- m1 `sync` et `observe` divergent (plafond de `sync` non testé) · m2 `keyFor` mort · m3 `sync` repeuple après `setSecret(null)` · m4 `list` ignore `deadline` · m5 une erreur d'environnement efface ses services · m6 commentaires en « apps » · m7 textes du volet vs R-003 · m8 vitrine et clic.
