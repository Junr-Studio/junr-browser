# Round 8 : performance

**Verdict : Approuvé.** Aucun bloquant ni majeur. Le mineur du round 7 est corrigé : retard de reprise après une attente de quota de 180 s à 0,2 s pour 420 s, de 200 s à 0,2 s pour 1000 s, de 299 s à 0,2 s pour 601 s ; 51 reprises au lieu de 35 sur 6 h à 420 s. Volume de requêtes inchangé (312 sur 3 h pour une attente d'une heure), un seul minuteur, aucune régression.

Mineur d'information, sans correctif : l'écart maximal entre deux redessins pendant une attente passe de 5 à 10 minutes dans les dix dernières minutes d'une longue attente (compromis assumé : reprise exacte contre redessin moins fréquent).
