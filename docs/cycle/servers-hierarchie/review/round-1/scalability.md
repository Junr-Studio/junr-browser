# Round 1, axe scalabilité : rouge

- B1 (bloquant) : aucune borne globale sur les items du snapshot ; 500 cibles × 500 apps = 250 000 lignes, 47 Mo de JSON. À borner côté noyau (lignes en échec et en cours d'abord, note du nombre masqué par la limite).
- M1 : `isHidden` en O(masqués) ; `view()` à 422 ms avec 10 000 apps et 2000 masqués. À remplacer par un `Set` testé sur les préfixes.
- M2 : un service en `WAITING`/`NEEDS_APPROVAL` garde son environnement au rythme rapide indéfiniment. À plafonner.
- M3 : troncature 500/1000 (corrigé avec le round architecture : plafond aligné sur 1000, note ajoutée).
- M4 : ordre non hiérarchique (corrigé : tri par espace puis projet).
- m1 à m7 : places du plafond prises par les masqués, projets > 500 sans pagination, budget entre pages, clés masquées orphelines, démarrage à froid, 429 pendant la découverte, suppression de `observed`.
