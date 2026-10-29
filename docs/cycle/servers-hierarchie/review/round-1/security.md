# Round 1, axe sécurité : vert

Aucun bloquant ni majeur. Quatre mineurs introduits par le cycle, un préexistant.

- M1 : en vitrine, un clic sur une ligne ouvre la page Railway réelle (noms visibles). À corriger : `servers-open` ne fait rien en vitrine.
- M2 : la garde d'URL n'est qu'un préfixe `https://`. À corriger : `new URL`, protocole https, sans identifiants.
- M3 : identifiants non validés (`/`, vide). À corriger : rejet des nœuds et apps dont l'id sort de `^[\w-]{1,100}$`.
- M4 : coût de `view()` avec une grosse flotte et 2000 masqués. Renvoyé à l'axe performance.
- P1 (préexistant) : les Réglages ne sont pas masqués en vitrine. À signaler à l'utilisateur, hors cycle.
