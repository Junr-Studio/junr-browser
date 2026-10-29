# Round 5 : sécurité

**Verdict : Bloqué** (un majeur). Aucune fuite de jeton ni de détail, aucune fuite mémoire, aucun rejet de promesse non géré. 401, 403 et 429 propagent le motif à toute la flotte ; l'âge affiché reste exact.

Majeur : M1, un état conservé pour une app sautée est présenté « En ligne » avec son âge, mais l'icône ne tient pas compte de l'âge et l'en-tête dit « Relevé à l'instant ». Correctif : dégrader en « Dernier relevé ancien » au-delà de quinze minutes ; ne pas avancer l'heure du relevé si rien n'a été tenté.

Mineurs : m1 un arrêt faible écrase un arrêt fort ; m2 une app sautée jamais relevée s'affiche « à l'instant » ; m3 `at` est l'heure de fin du lot ; m4 les erreurs réseau n'ont pas de code.
