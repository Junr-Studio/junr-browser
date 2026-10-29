# Round 4 : synthèse

Sécurité : Approuvé (jeton, lecture par morceaux, JSON illisible, délai de lecture : tout mesuré). Design system : Approuvé.

Architecture, performance et scalabilité : Bloqué, pour le même défaut introduit par la correction M-b du round 3 : tout échec répété comptait pour le disjoncteur, et les apps en erreur durable gardaient la plus ancienne date, donc ouvraient chaque relevé. Trois services supprimés parmi 500 coupaient le relevé de 497 apps, en permanence.

Correctif du round 5 (trois volets, vérifiés par tests) :
- une erreur propre à une requête (service supprimé, accès retiré) ne coupe plus le relevé, sauf si aucune app n'a répondu après dix essais ;
- une app non tentée (budget dépassé, coupure souple) est « sautée » : son dernier état connu reste affiché ;
- l'ordre des relevés suit la dernière *tentative* (`triedAt`), les apps dont la dernière réponse est une erreur passant après les autres. Une réponse « Aucun déploiement » compte comme une tentative.

Au passage : une demande plus large reçue dans le même tour que le début d'un relevé est rejouée (m-A de l'architecture).
