# Round 8 : scalabilité

**Verdict : Approuvé.** Aucun bloquant ni majeur, aucune régression par rapport au round 7. Quota de 100 requêtes/h sur 500 apps : 104 requêtes/h, toutes les apps lues après 4 h. Attentes de 420, 600, 601, 1000 et 3600 s : zéro requête pendant l'attente, reprise 0,2 s après l'échéance (latence simulée comprise), 0 à 11 redessins du minuteur. L'icône dégrade un état devenu ancien à 20 minutes avec au plus cinq minutes de décalage. Pas de boucle, un seul minuteur, au plus un déclenchement par minute.

Mineur informatif, déjà tracé : une attente d'environ 300 à 345 s peut reprendre en relevé partiel plutôt que complet ; le relevé complet attend alors le tick suivant (au plus 5 min).
