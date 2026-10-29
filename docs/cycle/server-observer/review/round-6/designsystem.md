# Round 6 : design system

**Verdict : Approuvé.** Aucun bloquant ni majeur. Rien n'a changé dans `shell/` depuis le round 5. L'affichage reste cohérent avec les états du noyau : ligne « Inconnu » avec son âge réel, `at: 0` donne « jamais relevé », l'aria-label retombe sur « inconnu » quand la marque est cachée. m5 et m6 du round 5 sont traités. Aucun état n'est défini à deux endroits côté interface.

Mineur m7 : l'aria-label annonce la marque pour toutes les apps (« 3 apps, en ligne ») même si l'une est présentée « Inconnu » ; correction possible (« dont N inconnue ») jugée de faible valeur.
