# Round 1 : architecture

Périmètre : le diff du cycle (src/servers/*, ipc.js, tabs.js, flyout.js, store.js, main.js, shell/*), plus PRD, architecture et requirements.

**Verdict : Approuvé.** Aucun bloquant, aucun majeur.

Mineurs (dette tracée) :
- m-1 : l'interface recalcule la clé d'identité d'une app (`shell/settings.js`) au lieu d'utiliser celle du noyau. À corriger : renvoyer `refKey` sur chaque nœud `app` de `browse`.
- m-2 : `f.key === 'token'` en dur pour un libellé ARIA (`shell/settings.js`).
- m-3 : `view()` peut instancier l'observateur (`src/servers/index.js`).
- m-4 : `observe` ne borne pas la taille de `ref`.
- m-5 : une demande reçue pendant un relevé n'est pas rejouée.
- m-6, m-7, m-8 : deux petits journaux à fichier ; `openInternal` modifié hors périmètre déclaré (à tracer) ; `require('node:crypto')` en ligne.
