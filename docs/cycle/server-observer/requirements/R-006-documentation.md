# R-006 Documentation et contrat d'observabilité

**Story** : S-1 à S-5 · **UAC couvertes** : (documentation)
**Dépend de** : R-001 à R-005
**Statut** : vert

## Comportement attendu
Le README décrit la fonction, ses limites (lecture seule garantie par le code, pas par le jeton ; requêtes à valider avec un jeton réel) ; `docs/SERVERS.md` donne la marche à suivre pour créer le jeton et ajouter un fournisseur.

## Contexte nécessaire
- `README.md` : tableau « Fonctionnalités » (ligne par domaine) et section « Limites connues » ; section « Structure ».
- Contenu de `docs/SERVERS.md` : jeton Railway de compte (rôle le plus restreint possible), où le poser (Réglages › Serveurs), ce qui est envoyé (HTTPS vers `backboard.railway.com` seulement), contrat fournisseur de `providers.js`.

## Couches
### 1–4
Absentes : documentation seule.

## Test cases
| Id | UAC | Couche | Comportement | Assertion |
|---|---|---|---|---|
| TC-006-1 | — | — | revue | liens et noms de fichiers existent |

## Définition de terminé
- [ ] README et `docs/SERVERS.md` à jour
