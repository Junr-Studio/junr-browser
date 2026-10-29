# Round 4 : design system

**Verdict : Approuvé.** Aucun bloquant ni majeur. m-F, m-G et m-H du round 3 sont levés (un seul bouton dont le libellé dépend de la liste, classe propre `.srv-sub`, test unitaire de `waitUntil`). m-I (capitales espacées de `.section-title`) reste hors de ce cycle, préexistant.

Mineurs (dette tracée)
- m1 : le libellé « Choisir les apps à observer » / « Gérer les serveurs » et le message d'attente du quota ne sont affirmés par aucun test e2e.
- m2 : `scrollbar-*` déclaré deux fois dans `shell/flyout.css`.
- m3 : `padding-bottom: 5px` redondant sur `.srv-head .section-title`.
- m4 : `max-height: 380px` du volet lié par coïncidence à sa largeur.
