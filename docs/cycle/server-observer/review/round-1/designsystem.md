# Round 1 : design system

**Verdict : Bloqué** (un majeur).

Majeur
- M1 : le vocabulaire d'état est écrit à deux endroits (`SERVER_STATE` dans `shell/flyout.js`, `SERVER_WORDS` dans `shell/shell.js`) qui divergent déjà (clé `unknown` absente, casse). Correctif : une table unique dans `shell/common.js`, déjà chargée par la barre et le volet.

Mineurs retenus pour le round 2
- m1 : règle morte `#servers-mark` (`box-shadow`) dans `shell/shell.css`.
- m2 : `.sname` recopie `.extname`.
- m3 : `#panel.servers .side-btn` recopie `#panel.extensions .side-btn`.
- m4 : `.srow:hover` annonce une interaction inexistante.
- m7 : bandeau de commentaire « À propos » déplacé dans `shell/settings.js`.
- m8 : `--bad` renommé `--danger` (même rôle que dans `settings.css`).
- m9 : état `unknown` jamais montré dans le test.
- m10 : `@keyframes spin` renommé `sd-spin`.
Sans suite : m5, m6.
