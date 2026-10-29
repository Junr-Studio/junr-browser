# Round 1 : performance

**Verdict : Approuvé.** Aucun bloquant. Mesures faites avec un `fetch` simulé (500 apps : `view()` 40 µs, snapshot 95 Ko et 187 µs de sérialisation).

Majeurs recommandés (corrigés au round 2, ils recoupent la scalabilité)
- M1 : chaque case cochée relance un relevé complet (100 cases : 1 962 requêtes au lieu de 100) ; les dernières restent « Pas encore relevé ».
- M2 : aucun plafond de durée d'un relevé (jusqu'à 42 min si le réseau ne répond pas).
- M3 : une requête par app (500 requêtes, 18,8 s à 150 ms ; période réelle d'environ 49 s en mode rapide).

Mineurs : snapshot complet vers la barre (négligeable à 50 apps) ; volet redessiné à chaque push ; animation continue des pastilles en déploiement. Sans problème : minuteurs, chevauchements, croissance de `readings`, déchiffrement.
