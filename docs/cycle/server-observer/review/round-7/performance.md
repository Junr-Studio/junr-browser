# Round 7 : performance

**Verdict : Approuvé.** Aucun bloquant ni majeur. Latence par requête, 500 apps, péremption à vingt minutes : aucune ligne « ancien » jusqu'à 1 s (14 % à 1,5 s, 36 % à 2 s, dégradation honnête). Le plafond du minuteur n'ajoute aucune requête pendant une attente de quota (312 requêtes sur 3 h, avant et après), 12 redessins par heure, un seul minuteur. 429 : l'app refusée garde son état et son rang. 3 services supprimés : 497 en ligne. Pas de fuite (60 puis 300 cycles d'ajout et de retrait).

Mineur retenu : le plafond du minuteur retardait de 0 à 5 minutes la reprise après une attente courte de quota (420 s : 180 s de retard, 35 reprises au lieu de 51 sur 6 h). Corrigé au round 8 : le minuteur n'est plafonné que s'il reste plus de dix minutes d'attente.
