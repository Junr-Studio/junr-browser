# Round 5 : architecture

**Verdict : Bloqué** (tests seulement). Le code est conforme à l'ADR-5, à l'ADR-6 et au contrat ; les frontières n'ont pas bougé.

Majeurs (tests, mutation) : T-1 le test C5 passait toujours ; T-2 la condition `answered === 0` du disjoncteur n'est protégée par aucun test ; T-3 la remise à zéro de `pending` n'est pas testée (une demande tardive coûterait quatre relevés).
Mineurs : T-4 la coupure souple n'est pas vérifiée comme « sautée » ; D-1 à D-3 documentation en retard sur `skipped` ; O-1 une app jamais tentée doit rester « nouvelle » ; O-2 un seul `now()` par lot ; O-3 le journal compte à tort les apps sautées.
