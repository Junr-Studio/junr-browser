# Relais de partage Junr

Transporte des paquets d'espace **déjà chiffrés pour le destinataire** : le serveur ne voit jamais cookies, stockage local, noms de clients ni d'outils. Il impose l'expiration (7 jours maximum) et l'usage unique, supprime le paquet à la première récupération et tient le journal (qui a déposé quoi, pour quelle empreinte, quand).

```
RELAY_TOKENS="alice:<jeton long et aléatoire>,bob:<jeton>" RELAY_ADMIN=alice RELAY_DIR=/var/lib/junr-relay RELAY_PORT=8787 node server/relay.js
```

| Variable | Rôle |
| --- | --- |
| `RELAY_TOKENS` | collaborateurs autorisés, `nom:jeton` (jeton ≥ 24 caractères) |
| `RELAY_ADMIN` | nom autorisé à lire le journal (`GET /v1/log`) |
| `RELAY_DIR` | stockage (défaut `./relay-data`) |
| `RELAY_HOST`, `RELAY_PORT` | écoute (défaut `127.0.0.1:8787`) |
| `RELAY_MAX_MB` | taille maximale d'un paquet (défaut 20) |

**À placer derrière HTTPS** (reverse proxy) : l'application refuse une adresse de relais en HTTP hors `localhost`. Les jetons ne sont jamais écrits en clair par l'application (coffre du système).

## API

| Appel | Effet |
| --- | --- |
| `PUT /v1/packets/<uuid>` | dépose un paquet `.junrshare` (en-tête vérifié : format, identifiant, destinataire, expiration ≤ 7 jours) |
| `GET /v1/packets/<uuid>` | récupère **et supprime** (410 ensuite) ; l'en-tête `X-Junr-Fingerprint` refuse un autre destinataire sans consommer le paquet |
| `DELETE /v1/packets/<uuid>` | l'expéditeur retire un paquet non récupéré |
| `GET /v1/log` | journal (administrateur) |

Le code de retrait donné au destinataire est l'identifiant du paquet (UUID aléatoire) ; sans la clé privée du destinataire, le contenu est illisible. Limites : 60 appels par minute et par collaborateur, 429 au-delà.

## Ce que le relais ne fait pas

- Il n'authentifie pas les **personnes** au-delà du jeton : l'authenticité de l'expéditeur repose sur la signature Ed25519 du paquet, vérifiée par le destinataire (empreinte affichée à l'import).
- Il ne révoque pas un paquet déjà récupéré (voir les risques du partage dans le plan).
