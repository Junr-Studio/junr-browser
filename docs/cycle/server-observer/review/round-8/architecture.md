# Round 8 : architecture

**Verdict : Approuvé.** Aucun bloquant ni majeur. 73 mutations rejouées sur une copie : les 8 survivantes du round 7 sont toutes détectées (étendue du minuteur, `lastFullAt`, `deploying` périmé, `STALE_MS`, âge négatif, `IDLE_MS/2`, statuts 500 à 503, `CODELESS_LIMIT`, `BUDGET_MS`) ainsi que la nouvelle ligne du minuteur. Le code respecte ADR-3, ADR-5 et ADR-6 ; la documentation concorde.

Mineurs (dette tracée, comportements de l'ADR-6 sans protection exacte)
- m-A : une demande plus large (`full`) n'est pas rétrogradée par une plus étroite (`new`) reçue dans la même fenêtre ; le test manque (le défaut se résorberait seul en cinq minutes).
- m-B : les 4xx autres que 401, 403, 429 ne coupent pas le relevé ; le test manque (30 apps répondant 404).
- m-C : le plafond du minuteur (5 min) et le seuil de 10 min ne sont pas figés par leur valeur exacte (test en `<=`).
- m-D : `CODELESS_LIMIT` à 9 survit (le test « neuf cassées » n'a que deux apps saines derrière).
- m-E : `backoffUntil` n'est pas protégé contre un raccourcissement ; latent tant que Railway est le seul fournisseur.
- m-F : une app nouvelle relève aussi les apps en déploiement (quelques requêtes en trop).
- Rédactionnel : deux parenthèses de suite à `03-architecture.md:65`, tailles du litmus à relire.
