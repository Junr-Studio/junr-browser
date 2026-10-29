# Round 3 : sécurité

**Verdict : Approuvé.** Aucun bloquant, aucun majeur. La contrainte tient : le jeton ne sert qu'à lire, reste chiffré, n'est jamais renvoyé à l'interface ni journalisé. `npm audit --omit=dev` : 0 vulnérabilité. Les trois mineurs du round 2 sont corrigés (jeton absent de la clé du cache, attente du quota respectée, plafond de réponse sur `content-length`).

Mineurs (dette tracée)
- M1 : sans `content-length` (transfert fractionné), la réponse est lue en entier avant d'être refusée au-delà de 5 Mo ; mesuré : 371 Mo de mémoire pendant 584 ms. Suppose un intermédiaire TLS de confiance compromis, pas un chemin ouvert à une page web. Correctif : lire `res.body` par morceaux et annuler au-delà de la limite.
- M2 : un JSON invalide cite les premiers caractères de la réponse dans le message d'erreur. Correctif : remplacer par « réponse illisible ».
- Remarques : un délai écoulé pendant la lecture du corps n'a pas le code `timeout` ; `browse()` n'est pas retenu pendant une attente du quota (gestes manuels, cache de 60 s) ; l'attente est globale à tous les fournisseurs.
