# Round 1 : sécurité

**Verdict : Approuvé.** Aucun bloquant, aucun majeur.

Vérifié par le reviewer : canaux admin réservés aux pages internes ; le jeton ne revient jamais à l'interface (config, snapshot, journal, erreurs, y compris un jeton cité par une erreur d'en-tête) ; le jeton n'est pas envoyé à un autre hôte (redirection 307 testée) ; garde lecture seule (table gelée, variables typées) ; aucune injection par les noms renvoyés par Railway (pas d'`innerHTML`, CSP stricte) ; aucune dépendance ajoutée.

Mineurs retenus pour le round 2
- M1 : un secret illisible (profil copié, trousseau réinitialisé) provoque des rejets de promesse non gérés ; les apps devraient passer « Jeton illisible » ; ajouter `.catch` sur les `refresh()` non attendus.
- M2 : `ref` non validé (forme, taille).
- M3 : en vitrine, les apps non rattachées restent lisibles.
- M4 : amplification de requêtes (voir scalabilité B1).
- M5 : `redirect: 'error'` et plafond de taille de réponse.

Préexistant, hors diff : `src/secrets.js` ne vérifie pas le moteur de stockage ; sous Linux avec `basic_text`, le « chiffrement » vaut du clair. L'application cible Windows (DPAPI).
