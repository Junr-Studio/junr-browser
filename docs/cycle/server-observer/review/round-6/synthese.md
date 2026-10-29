# Round 6 : synthèse

- **Sécurité, performance, scalabilité, design system** : Approuvé (aucun bloquant ni majeur).
- **Architecture** : Bloqué sur des tests seulement (97 mutations appliquées au code : le choix d'étendue du minuteur, la liaison du budget `deadline` et l'avancement de `checkedAt` n'étaient protégés par aucun test).

Corrections du round 7
- Tests ajoutés pour chaque mutation survivante (choix d'étendue du minuteur avec une horloge réaliste, `deadline = started + BUDGET_MS` transmis au fournisseur, `checkedAt` après un relevé réussi et un relevé mixte, seuil de péremption à 14 et 21 minutes, motif d'un inconnu ancien conservé, trois échecs de suite coupent / deux ne coupent pas / la remise à zéro, 403 et 5xx). Le test « un arrêt faible n'écrase pas un arrêt fort » est retiré : les gardes `strong` et `!stop` étaient du code mort (le worker qui pose l'arrêt remplit tout le reste de façon synchrone), elles sont supprimées.
- Le 429 saute aussi les requêtes déjà en vol (elles gardent leur état et leur rang).
- Le minuteur se déclenche au plus toutes les 5 minutes, même pendant une longue attente de quota, pour que l'icône dégrade un état devenu ancien.
- Le seuil de péremption passe à 20 minutes (quatre relevés lents), un âge négatif (horloge qui recule) est traité comme périmé, une seule date par appel de `view()`.
- Documentation : tailles du litmus, flotte supérieure au quota, démarrage à froid.

Conflit entre reviewers tranché : la scalabilité proposait de reprendre au rythme rapide les apps jamais tentées (démarrage à froid) ; la performance le déconseille (un schéma refusé partout passerait de 156 à plus de 1 200 requêtes/h). Suivi : performance. Documenté dans l'ADR-6.

Non traité, mineur : doublement progressif de l'attente quand un 429 n'a pas de `Retry-After` ; un 401/403 propre à une seule app aveugle le reste de la flotte (improbable : Railway répond vraisemblablement en 200 avec un message GraphQL) ; `checkedAt` avance même quand toutes les tentatives d'un relevé échouent (borné par la règle des vingt minutes).
