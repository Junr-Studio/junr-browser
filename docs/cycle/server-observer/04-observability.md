# Observabilité server-observer

L'application n'a pas de console une fois installée (voir `updater.js`). Contrat minimal :

| Quoi | Où | Seuil |
|---|---|---|
| Dernier relevé (heure, nombre d'apps, erreurs par fournisseur) | affiché dans le volet (heure) et `state.servers.lastError` | une erreur persistante est visible : les apps passent en « Inconnu » avec le motif |
| Journal des relevés qui comptent des états inconnus | `userData/servers.log` (remplacé par `servers.log.1` au-delà de 200 Ko), jamais le jeton | une ligne par relevé concerné |
| Durée d'un relevé | ligne du journal | alerte humaine si > 20 s (délai d'expiration) |

Pas de métrique envoyée hors de la machine.
