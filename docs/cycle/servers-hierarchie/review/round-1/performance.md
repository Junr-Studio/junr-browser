# Round 1, axe performance : rouge

- Majeur : `isHidden` en O(masqués) avec allocation par clé ; `view()` 596 ms pour 5000 items et 2000 clés masquées, appelé à chaque snapshot. À remplacer par un `Set` testé sur la clé et ses préfixes.
- Mineurs : rendu du volet reconstruit en entier à chaque push, items calculés même sans volet ouvert, clés masquées jamais purgées. Reportés (le plafond d'items du noyau borne le rendu).
