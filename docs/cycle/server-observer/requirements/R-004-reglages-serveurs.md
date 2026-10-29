# R-004 Section Réglages › Serveurs

**Story** : S-3 · **UAC couvertes** : UAC-3.1, 3.3, 3.6, 3.7, 5.3
**Dépend de** : R-003
**Statut** : vert

## Comportement attendu
Une section « Serveurs » dans les Réglages permet de poser le jeton, parcourir espace de travail → projet → apps, cocher les apps à observer et les rattacher à un client.

## Contexte nécessaire
- Fichier : `shell/settings.js` (helpers existants `h`, `api`, `run`, `toast`, table `SECTIONS` ligne ~399 ; modèle : `sectionShare` pour un jeton `type=password` avec placeholder « Jeton enregistré (laisser vide pour le conserver) »). CSP de la page : `default-src 'none'; style-src 'self'; script-src 'self'` : pas de style en ligne ni de script en ligne.
- Appels : `api('servers.config')`, `api('servers.setSecret', {provider,key,value})`, `api('servers.browse', {provider,path})`, `api('servers.observe', app)`, `api('servers.unobserve', {id})`, `api('servers.assign', {id,clientId})`.
- Contenu : fournisseur (Railway) avec champ jeton ; arbre déroulable (espaces de travail → projets) chargé à la demande ; apps avec case à cocher ; liste des apps observées avec sélecteur de client (option « Non rattachée ») et bouton retirer ; message si la liste est tronquée. Libellés en français. Entrée `servers: ['Serveurs', sectionServers]` dans `SECTIONS`.

## Couches
### 1 migration & actions
Absente : fournies par R-003.
### 2 logique
Absente.
### 3 UI
`shell/settings.js`, `shell/settings.css` (classes existantes `card`, `row`, `btn` réutilisées d'abord).
### 4 intégration
Aucune.

## Test cases
| Id | UAC | Couche | Comportement | Assertion |
|---|---|---|---|---|
| TC-004-1 | UAC-3.1 | 3 | page Réglages › Serveurs avec faux fournisseur | l'arbre se déroule et propose des apps |
| TC-004-2 | UAC-3.6/3.7 | 3 | cocher deux fois, décocher | une entrée, puis aucune |
| TC-004-3 | UAC-5.3 | 3 | le DOM de la section | ne contient jamais la valeur du jeton |

## Définition de terminé
- [ ] tous les test cases verts
- [ ] aucune régression sur la suite existante
- [ ] rien ajouté qui ne soit demandé ici
