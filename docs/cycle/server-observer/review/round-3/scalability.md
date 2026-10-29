# Round 3 : scalabilité

**Verdict : Bloqué.** C1, C2, C4, C7 et C8 du round 2 sont corrigés. Un bloquant introduit par la correction C5/C7 :

- B1 : quand un relevé se termine sans `await` (attente du quota, ou aucun jeton), le `finally` s'exécute avant l'affectation de `inflight` : `inflight` reste figé sur une promesse résolue et le sondage ne repart plus jamais, sans erreur. Deux chemins reproduits : clic sur « Actualiser » pendant une attente du quota, puis attente expirée ; jeton retiré puis reposé.

Mineurs : M-a coût du rythme rapide non plafonné (une app bloquée en déploiement = 120 requêtes/h) ; M-b les erreurs sans code (schéma GraphQL faux) ne comptent pas dans le disjoncteur ; M-c le budget de 45 s écrase des états connus ; M-d l'attente est globale à tous les fournisseurs et changer de jeton ne la lève pas ; M-e une exception dans `poll` relancerait un relevé par seconde ; M-f un minuteur qui part 1 ms avant l'expiration saute un cycle.

C3 : la documentation est un traitement acceptable à condition de corriger le seuil (83 apps pour un quota supposé de 1 000/h, pas « une centaine »), de dire que 500 est une borne de stockage et non de service, et de tracer la vérification du quota dans les questions ouvertes du PRD.
