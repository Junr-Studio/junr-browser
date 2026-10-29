# Round 2, axe sécurité : vert

Les correctifs M1 (vitrine), M2 (URL) et M3 (ids) du round 1 tiennent.

- m1 : `railway.js` `list()` réenveloppe l'erreur de la requête `tree` et perd `code` et `backoffMs` ; le correctif du noyau n'est donc pas atteint avec Railway. À corriger, avec test.
- m2 : `urlOf` ne tient pas compte du masquage. À corriger (une ligne).
- m3 : borne théorique de mémoire (500 × 1000 apps). Reporté.
- P1 (préexistant) : les Réglages ne sont pas masqués en vitrine, surface agrandie par le cycle. Décision pour l'utilisateur.
