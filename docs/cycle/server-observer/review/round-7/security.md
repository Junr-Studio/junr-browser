# Round 7 : sécurité

**Verdict : Approuvé.** Aucun bloquant, aucun majeur, aucune régression de sécurité. Le minuteur plafonné ne lance aucune requête pendant une attente de quota (le tour est vide, il redessine seulement) ; l'état de plus de vingt minutes ou daté dans le futur est présenté « Dernier relevé ancien » ; aucun secret dans `view()`, `config()`, `EMPTY` ni le journal ; aucun rejet de promesse non géré ; aucune dépendance ajoutée.

Mineurs (dette tracée)
- m5 (journal non rédigé) : écarté. `redact` sans les identifiants fait déjà ce que fait la ligne, et ajouter les identifiants élargirait la surface.
- m6 : un arrêt faible arrivé après un arrêt fort peut écraser son motif (quatre requêtes en vol, trois échecs mous) ; aucun envoi supplémentaire, aucune fuite.
- m7 : reposer le même jeton lève l'attente demandée (geste de l'utilisateur, voulu).
- Round 6, inchangés : `checkedAt` avance quand tout un relevé échoue ; flotte entièrement inconnue sans marque ; hypothèse de rotation plus rapide que le seuil.
