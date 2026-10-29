# Round 8 : sécurité

**Verdict : Approuvé.** Aucun constat nouveau. Le nouveau calcul du minuteur n'ouvre aucune fenêtre : attente courte (≤ 10 min), le minuteur tombe à l'échéance + 50 ms ; longue attente, il tombe plus tôt, le garde `now() >= backoffUntil` de `refresh` saute le relevé (aucune requête, aucun déchiffrement) et l'interface est redessinée ; aucun trou entre les deux régimes. La contrainte sur le jeton tient. Dette inchangée : m6, m7, `checkedAt` après un relevé entièrement échoué, flotte entièrement inconnue sans marque.
