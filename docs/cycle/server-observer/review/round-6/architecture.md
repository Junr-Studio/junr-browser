# Round 6 : architecture

**Verdict : Bloqué** (tests seulement). Le code respecte l'architecture : frontières, contrat, ADR-5 (un seul minuteur, un relevé à la fois, pas de gel ni de boucle). 97 mutations appliquées sur une copie : la plupart sont détectées.

Bloquants (tests manquants, aucune modification du code livré requise)
- B-1 : l'étendue choisie par le minuteur (`full` après 5 min, sinon `live`) n'est lue par aucun test ; avec `live` en toutes circonstances les apps stables passeraient en « Dernier relevé ancien » au bout de quinze minutes sans qu'aucun test ne rougisse.
- B-2 : la liaison observateur → fournisseur du budget (`deadline = started + BUDGET_MS`) n'est testée nulle part ; `deadline = BUDGET_MS` sauterait toutes les apps en production.
- B-3 : l'avancement de `checkedAt` après un relevé réussi n'est pas testé.

Mineurs : m-1 les gardes `strong` et `!stop` de railway.js sont du code mort (la boucle d'un worker remplit tout le reste de façon synchrone) et le test m1 passe avec ou sans ; m-2 seuils du disjoncteur souple non testés (3 de suite, remise à zéro, 403, 503) ; m-3 STALE_MS : seuil bas et états non « online » non testés ; m-4 pendant une attente de quota supérieure à quinze minutes, aucun redessin ne dégrade l'icône ; m-5 mutations équivalentes ; m-6 tailles du litmus périmées, `EMPTY` sans `waitUntil`.
