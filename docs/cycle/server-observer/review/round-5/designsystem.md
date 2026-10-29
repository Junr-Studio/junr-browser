# Round 5 : design system

**Verdict : Approuvé.** Aucun bloquant ni majeur. `shell/` n'a pas changé depuis le round 4 ; l'âge d'une app « sautée » reste exact (le volet lit `at`, qui ne bouge pas sur une app non tentée).

Mineurs (dette tracée)
- m5 : une app sautée sans aucun relevé reçoit un placeholder `unknown` daté de « maintenant » ; `at: 0` donnerait « jamais relevé ».
- m6 : la marque de l'icône agrège les états sans tenir compte de leur âge (conséquence assumée de « garder le dernier état connu »).
- m1 à m4 du round 4 inchangés.
