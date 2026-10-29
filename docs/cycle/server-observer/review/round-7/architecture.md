# Round 7 : architecture

**Verdict : Bloqué** (tests et documentation seulement). Le code respecte ADR-3, ADR-5 et ADR-6. B-1, B-2 et B-3 du round 6 sont couverts. 85 mutations appliquées : 67 tuées, 18 survivantes dont 9 équivalentes.

Bloquant
- BL-1 : un relevé partiel pourrait repousser le relevé complet (mutation « `lastFullAt` posé par tous les modes » survivante) : les apps stables passeraient en « Dernier relevé ancien » tant qu'une app reste en déploiement, sans qu'aucun test ne rougisse.

Majeurs
- M-1 : un état `deploying` périmé n'est pas testé (seuls `failed` et `online` le sont).
- M-2 : `STALE_MS` n'est pas figé à vingt minutes (le test borne à 14 et 21 minutes : 3× passe).

Mineurs : âge négatif sans test ; borne basse du relevé complet (`IDLE_MS/2`) ; valeurs numériques non figées (`BUDGET_MS` comparé à lui-même, statut 500, `CODELESS_LIMIT`) ; `checkedAt` après une tentative entièrement échouée ; motif d'une app sautée sans relevé ; `EMPTY` et `view()` peuvent diverger ; garde redondante `r.at > 0`.

Écarts de documentation : ADR-6 « quinze minutes » ; litmus d'`observer.js` (~200 lignes annoncées, 292 réelles) ; `SERVERS.md` « 0,75 s » (à passer à environ 1 s).
