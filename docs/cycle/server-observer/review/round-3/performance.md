# Round 3 : performance

**Verdict : Bloqué.** Les mesures du round 2 sont reproduites et conformes : 6 101 requêtes/h à 500 apps dont une en déploiement ; panne 502 = 72 requêtes/h ; échec isolé = 1 inconnue ; `view()` = 20 µs ; minuteur unique ; pas de croissance de Map.

Majeur
- M1-bis : le tri « inconnues d'abord, puis plus ancien `at` » retombe sur l'égalité quand les apps non atteintes reçoivent toutes le même `at`, et l'ordre d'origine revient : au-delà de `apps > 2 × capacité du budget` (latence > 720 ms à 500 apps), 132 apps (à 1 s) ne sont jamais relevées. Correctif : un `okAt` qui ne bouge que sur une réponse réelle ; trier dessus.

Mineurs : le budget dépassé efface le dernier état connu (décision de contrat, non faite) ; trois 5xx simultanés coupent la flotte restante (arbitrage assumé) ; l'entrée expirée du cache de projets reste jusqu'au prochain appel.
