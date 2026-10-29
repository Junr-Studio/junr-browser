# Round 2 : architecture

**Verdict : Approuvé.** Aucun bloquant, aucun majeur. Les frontières tiennent (noyau sans mot propre à Railway, Electron seulement dans `index.js`, pas de cycle de chargement) et ADR-5 reste respectée avec le relevé en attente.

Mineurs
- M-A : le port et l'ADR-5 de `03-architecture.md` ne décrivent pas le contrat à jour (`deadline`, `backoffMs`, `validateRef`, étendues new/live/full, rejeu, budget de 45 s). À tracer en ADR-6.
- M-B : « Actualiser » pendant un relevé partiel ne produit pas de relevé complet ; une action de l'utilisateur ignore `backoffUntil`.
- M-C : le plafond de 3 tours efface la demande en attente.
- M-D : commentaire inexact dans `src/servers/index.js`.
- M-E : `deadline` est en ms epoch (`Date.now()`) : à préciser dans le contrat.
- M-F : `keyFor` et `nextDelay` exportés pour les tests.
- m-7 (round 1) : le changement d'`openInternal` doit être tracé dans `03-architecture.md`.
