# Round 2 : sécurité

**Verdict : Approuvé.** Aucun bloquant, aucun majeur. La contrainte tient : le jeton ne sert qu'à lire, reste chiffré, n'est jamais renvoyé à l'interface ni journalisé. Les cinq mineurs du round 1 sont corrigés. `npm audit --omit=dev` : 0 vulnérabilité.

Mineurs restants
- Le plafond de 5 Mo est testé après la lecture complète de la réponse (`res.text()`), et en caractères ; le commentaire de `railway.js` est inexact.
- Le jeton en clair sert de clé au cache des projets, sans éviction ; il reste en mémoire après « Effacer ». À remplacer par un haché et à purger.
- `backoffUntil` ne retient pas un relevé manuel (« Actualiser ») ni l'ajout d'une app ; il est global à tous les fournisseurs.
- `refKey` contient le `ref` en clair (non secret pour Railway) ; le contrat devrait interdire les secrets dans `ref` ; l'ordre des clés JSON influe sur le dédoublonnage.
