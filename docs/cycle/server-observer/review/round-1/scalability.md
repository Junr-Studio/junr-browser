# Round 1 : scalabilité

**Verdict : Bloqué** (un bloquant, quatre majeurs).

Réserve : les quotas de l'API Railway n'ont pas pu être vérifiés (pas de jeton ni de réseau pour le reviewer). Les ordres de grandeur sont à confirmer, mais 500 requêtes par relevé dépassent tout quota raisonnable.

Bloquant
- B1 : une requête par app, aucun traitement du 429 ni de `Retry-After`, aucun disjoncteur sur 401/403/429/délai, et le rythme rapide (30 s) relève toute la flotte dès qu'une seule app est en déploiement. À 500 apps : 6 000 requêtes/h au repos, 60 000/h en mode rapide.

Majeurs
- M1 : chaque case cochée déclenche un relevé complet ; une demande reçue pendant un relevé est perdue pour un tour (l'app affiche « Pas encore relevé »).
- M2 : durée d'un relevé non bornée (500 apps / 4 en parallèle ; Railway qui pend : 40 min sans retour à l'interface) ; les fournisseurs sont relevés en série ; un seul minuteur pour tous.
- M3 : le snapshot de 500 apps part à chaque push, vers la barre qui n'en a pas besoin et vers tous les volets.
- M4 : chaque dépliage de projet recharge les 200 projets du workspace.

Mineurs : produit cartésien services × environnements ; réécriture du JSON à chaque action ; Réglages reconstruits à chaque action ; journal franchit 200 Ko en moins d'une journée en mode rapide ; quota partagé entre installations.
