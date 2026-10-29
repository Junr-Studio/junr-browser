# Round 3 : architecture

**Verdict : Approuvé.** Aucun bloquant, aucun majeur. Le code correspond à l'ADR-6 et au contrat du port ; ADR-5 tient ; les frontières n'ont pas bougé. M-A à M-D du round 2 sont traités.

Mineurs (dette tracée)
1. Le délai d'attente demandé par un fournisseur est global : un 429 de A retient aussi B. Sans effet tant qu'il n'y a qu'un fournisseur ; à lever avec le second (`Map` par fournisseur).
2. Défaut latent : si `poll` levait une exception, `next` garderait la valeur du tour fautif et le `finally` armerait une reprise à 1 s, sans fin. Aucun chemin actuel ne lève (`safeStatuses`, `credsOf`, `log` sont protégés).
3. L'étendue `live` est décrite comme « en transition ou inconnues » dans deux commentaires et dans `SERVERS.md` ; le code retient les apps en déploiement et celles jamais relevées.
4. L'unité de `deadline` (ms epoch, comparable à `Date.now()`) n'est écrite ni dans le contrat ni dans `SERVERS.md`.
5. `keyFor`, `nextDelay` et les crochets `_gql`, `_assertReadOnly`, `_cacheKeys` ne sont exportés que pour les tests (accepté).
6. L'ADR-6 devrait dire qu'elle précise l'ADR-5.
