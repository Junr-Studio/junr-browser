# Round 6 : sécurité

**Verdict : Approuvé.** Aucun bloquant, aucun majeur. Le majeur du round 5 est levé : l'icône, l'en-tête et les lignes cessent de présenter un état comme frais au plus tard quinze minutes après la dernière confirmation (mesuré sur 50 apps : panne 5xx, erreur réseau, 401, 200 avec `errors`, 429). Aucune trace du jeton dans `view()`, `config()` ni le journal, y compris quand le jeton apparaît dans un message d'erreur de fetch (remplacé par `[secret]`). Aucune dépendance ajoutée.

Mineurs (dette tracée)
- m1 : l'en-tête dit « Relevé à l'instant » alors que tous les essais d'un relevé ont échoué (pannes 5xx, réseau, 200 avec `errors`) ; borné à quinze minutes et chaque ligne dit son âge. Correctif : n'avancer `checkedAt` que si une app tentée a répondu autrement que `unknown`.
- m2 : une flotte entièrement inconnue n'a aucune marque sur l'icône (marque neutre, comme le prévoit UAC-3.8) ; un tiret gris serait plus lisible.
- m3 : le seuil de quinze minutes suppose une rotation de relevé plus rapide (500 apps ≤ environ 1 s par requête) ; au-delà, des apps restent « Dernier relevé ancien » de façon visible.
- m4 : un recul de l'horloge système rend l'âge négatif ; à traiter comme périmé.
- m5 : le journal d'un relevé en erreur (`detached`) n'est pas rédigé ; aucun chemin actuel n'y met le jeton.

Choix assumé accepté : « Not Authorized » en HTTP 200 n'est pas traité comme un jeton refusé (coût mesuré : 10 à 13 requêtes par relevé ; l'alternative rouvrirait le bloquant du round 4).
