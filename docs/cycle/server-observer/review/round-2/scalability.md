# Round 2 : scalabilité

**Verdict : rouge pour le round suivant** (le reviewer écrit « Approuvé sous réserve de C1 et C2 » ; ce sont deux majeurs, corrigés avant le round 3). Le bloquant B1 du round 1 est levé : 429, 401, 403 et délai coupent l'envoi, `Retry-After` est lu, le backoff ne s'accumule pas, le rythme rapide ne relève plus toute la flotte. M1 à M4 sont levés.

Majeurs
- C1 : en rythme rapide, les apps « inconnues » (déploiements tous retirés, service supprimé) sont relevées à chaque tick de 30 s. Correctif : `live` ne retient que les apps en déploiement et celles jamais relevées ; les inconnues sont reprises par le relevé complet.
- C2 : un seul délai dépassé coupe tout le relevé (jusqu'à 40 % des relevés à 500 apps), et les 5xx ne déclenchent rien. Correctif : 401/403/429 coupent tout de suite ; délai et 5xx après 3 échecs consécutifs.
- C3 : une requête par app et par relevé (O(N) contre un quota fixe ; le quota Hobby supposé est dépassé au repos au-delà d'environ 83 apps). Décision de périmètre : plafond annoncé dans `docs/SERVERS.md`, requête par projet à valider contre un compte réel.

Mineurs retenus : C4 famine de la queue quand le budget est atteint (trier par ancienneté de relevé) ; C5 « Actualiser » ignore le backoff et ne devient pas un relevé complet pendant un relevé partiel ; C7 le plafond de 3 tours perd la demande en attente ; C8 cache des projets sans éviction, jeton en clair dans la clé. Sans suite : C6, C9, C10.
