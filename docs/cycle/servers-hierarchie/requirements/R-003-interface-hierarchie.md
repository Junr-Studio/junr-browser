# R-003 Interface en hiérarchie avec ouverture de la page Railway

**UAC (brief)** : volet comme Railway · en cours en tête · clic ouvre la page · Réglages : masquer
**Dépend de** : R-002 · **Statut** : à faire

## Comportement attendu
Le volet range les apps comme Railway avec les déploiements en cours en tête, un clic ouvre la page Railway de l'app, et Réglages › Serveurs permet de masquer à tout niveau.

## Contexte nécessaire
- Fichiers : `src/ipc.js` (table `admin`, appels `servers.*`), `src/flyout.js` (liste fermée `actions`, `keepOpen`), `src/tabs.js` (`serversView`, vitrine), `shell/flyout.js` (`renderServers`, `serverRow`), `shell/flyout.css`, `shell/settings.js` (`sectionServers`, `serverProviderCard`, `serverTree`), `shell/settings.css`, tests `test/smoke.js` (sections « Serveurs : … »), `docs/SERVERS.md`, `README.md`. Chargement de `shell/common.js` avant `shell/flyout.js` (`el`, `ago`, `SERVER_STATE`).
- IPC admin : supprimer `servers.browse`, `servers.observe`, `servers.unobserve`, `servers.assign` ; ajouter `servers.setHidden({ key, hidden })` → `servers.setHidden(String(key), !!hidden)`. Garder `servers.config`, `servers.setSecret`, `servers.refresh`.
- Geste de volet : `'servers-open': async (id) => { const url = servers.urlOf(String(id)); if (!url) return; const t = tabs().addTab({ spaceId: 'global', url }); await tabs().activateTab(t.id); }` dans `actions` de `src/flyout.js` (le volet se referme et la page reprend le clavier, comme les autres gestes).
- Vitrine (`serversView`) : tous les noms (`label`, `project`, `workspace`, `environment`, `detail`) sont vidés ; `notes` vidées ; les états restent.
- Volet (`renderServers`) : en-tête inchangé (« Serveurs », heure du relevé ou attente de quota, bouton Actualiser). Corps : (1) si des items sont `deploying` : titre « En cours de déploiement » puis leurs lignes (sous-titre `projet · environnement`), **retirées** de la hiérarchie ci-dessous ; (2) hiérarchie : titre de l'espace seulement s'il y a plus d'un espace, titre du projet, sous-titre de l'environnement (classe `srv-env`), lignes. Une ligne est un `<button class="srow">` (nom, état en mot et en forme, âge) dont le clic appelle `act('servers-open', it.id)`. Les `notes` s'affichent en pied de liste (classe `empty-note`). Liste vide : « Aucune app à afficher. » et le bouton vers Réglages › Serveurs ; sinon le bouton « Gérer les serveurs ».
- Réglages › Serveurs : carte du fournisseur (jeton) inchangée, supprimer le bouton « Parcourir », l'arbre de parcours et le tableau « Apps observées ». Ajouter la carte « Apps affichées » : arbre `config().tree` avec, pour chaque nœud, une case « affiché » (cochée = non masqué ; désactivée et décochée si `inherited`) et un bouton de dépliage si le nœud a des enfants (ouverture gardée dans une variable du module) ; case décochée appelle `api('servers.setHidden', { key, hidden: true })`. Texte d'aide : tout s'affiche par défaut ; les notes du fournisseur s'affichent sous l'arbre.
- Les tests e2e `test/smoke.js` : réécrire les trois sections « Serveurs : … » pour le nouveau modèle (faux fournisseur `demo` avec `list` et `statuses` à `apps`).

## Couches
1 migration & actions : absente. 2 logique : `ipc.js`, `flyout.js` (src), `tabs.js`. 3 UI : `shell/*`. 4 intégration : test e2e.

## Test cases
| Id | Couche | Comportement | Assertion |
|---|---|---|---|
| TC-3-1 | 3 | volet avec deux apps en cours et quatre autres sur deux projets | « En cours de déploiement » en premier avec 2 lignes ; hiérarchie sans ces deux lignes |
| TC-3-2 | 3 | un seul espace / deux espaces | titre d'espace absent / présent |
| TC-3-3 | 4 | clic sur une ligne | un onglet s'ouvre dans l'espace des outils communs sur l'adresse du fournisseur |
| TC-3-4 | 4 | `servers-open` avec un identifiant inconnu | aucun onglet |
| TC-3-5 | 3 | Réglages : décocher un projet | `servers.config` le donne `hidden`, ses enfants `inherited`, le volet ne le montre plus |
| TC-3-6 | 3 | vitrine | aucun nom (espace, projet, environnement, service) dans le volet |
| TC-3-7 | 3 | liste vide | message et bouton vers Réglages |
| TC-3-8 | 3 | 60 apps | la liste défile, le volet reste dans la fenêtre |
| TC-3-9 | 3 | jeton absent de la page Réglages | aucune valeur de jeton dans le DOM |

## Définition de terminé
- [ ] test cases verts · [ ] sections e2e réécrites · [ ] `docs/SERVERS.md` et `README.md` à jour · [ ] rien d'ajouté hors de ce fichier
