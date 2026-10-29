# Round 6 : scalabilité

**Verdict : Approuvé.** Aucun bloquant ni majeur. Les deux majeurs du round 5 sont levés (simulations, 500 apps, 4 requêtes en parallèle) : sous un quota de 100 requêtes/h, 100 nouvelles apps sont lues chaque heure et les 500 le sont toutes en 9 h (au round 5 : 100 apps distinctes pour toujours) ; une panne 5xx prolongée dégrade l'icône à +16 min pour environ 72 requêtes/h. 3 services supprimés sur 500, 4 cassées + 20 saines, 12 cassées en tête, schéma refusé partout (156 requêtes/h), 401 (52 requêtes/h), jeton retiré puis reposé, `stop()`/`start()` : tous conformes.

Mineurs retenus pour le round 7
- M1 : la requête qui prend un 429 est datée comme tentée et perd son dernier état ; elle doit être marquée sautée.
- M2 : une app sautée sans relevé attend le relevé suivant (5 min) au lieu d'être reprise tout de suite ; `nextDelay` doit passer au rythme rapide tant qu'une app n'a jamais été tentée.
- M3 : le délai du minuteur peut atteindre une heure (long `Retry-After`) : l'icône périmée n'est recalculée qu'au push suivant ; plafonner le délai à cinq minutes (le relevé ne part pas pendant l'attente, il redessine seulement).
- M4 : `STALE_MS = 3 × IDLE_MS` est trop court dès que la rotation dépasse deux relevés (500 apps à plus de 0,75 s par requête) ; passer à quatre.
- M5 : un 429 sans `Retry-After` n'attend qu'une minute (240 requêtes refusées sur 340 en une heure sous quota de 100/h) ; doublement progressif à envisager.
- E1 (préexistant, spéculatif) : un 401/403 propre à une seule app aveugle le reste de la flotte ; laissé tel quel faute de signal réel.

C3 : ajouter à `docs/SERVERS.md` la conséquence d'une flotte supérieure au quota (rotation, la plupart des apps « Dernier relevé ancien »).
