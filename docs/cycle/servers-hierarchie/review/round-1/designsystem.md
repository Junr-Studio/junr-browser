# Round 1, axe design system : rouge

Périmètre : diff non commité de `shell/flyout.{js,css}`, `shell/settings.{js,css}`.

- Majeur 1 : `--side-hover` n'était défini nulle part (repli en dur). Corrigé : jeton posé dans `shell/common.css`, repli retiré.
- Mineur 1 : `.srow` avait un rayon de 6 px et pas de transition. Corrigé : 8 px et `transition: background .12s`.
- Mineur 2 : `div` dans un `button`. Corrigé : `span` (`.stop`, `.ssub` en `display:block`).
- Mineurs 3 à 6 : indentation des lignes sous l'environnement, `.node-gap` en 26 px, paramètre `withPath`, ordre des données. Non bloquants, à revoir au prochain round.
