# Junr Browser

Navigateur de bureau multi-clients basé sur Electron (Chromium embarqué) : un espace étanche par client, des outils communs, des extensions du Chrome Web Store (avec un pont d'API `chrome.*` maison), la mise en veille des onglets inactifs et le partage d'un espace entre collaborateurs. Les conclusions des mesures et les décisions à prendre sont dans **`docs/phase0-conclusion.md`**.

## Lancer

```
npm install
npm start            # Linux en root : npm run start:root
npm test             # plus de 500 vérifications automatiques (Linux sans écran : xvfb-run est utilisé automatiquement)
```

## Le carnet de clients (interface)

Junr n'est pas un navigateur avec des onglets rangés par client : chaque client est un **lieu** à l'identité fixe (monogramme, couleur, cadre) dont on lit l'état des outils d'un coup d'œil, et dont on retrouve la mémoire à chaque retour. Rien n'est envoyé nulle part : tout est calculé localement, sans lire le contenu des pages.

| Idée | Comportement |
| --- | --- |
| **Barre unique** | Une seule barre en haut (46 px, elle sert aussi de barre de titre) : l'**avatar** du client à gauche (le survol ouvre la liste des clients, leurs groupes d'onglets, les outils communs, la vitrine et les réglages), les **onglets en icônes** (favicon ; le titre et le site au survol), l'**adresse**, puis les extensions épinglées et l'icône puzzle (le survol liste toutes les extensions et permet de les épingler). La page occupe **toute la largeur** et toute la hauteur sous la barre : mêmes proportions que Chrome, identiques pour tous les clients |
| **Identité du lieu** | Liseré à la couleur du client en haut de la barre (3 px ; 6 px pour un client « sensible »), avatar à son monogramme, titre de fenêtre. Un outil commun a un liseré gris et des onglets hachurés. Ctrl+T sur un outil commun demande le client, sans présélection |
| **Pastilles d'outils** | Une pastille par outil dans le volet des clients ; la forme dit l'état : pointillé = jamais ouvert, anneau = en veille, plein = éveillé, carré blanc = a bougé, triangle = audio, anneau orange barré = connexion demandée. Le compteur est lu dans le titre de la page (`(3) Boîte…`) ; la première lecture fixe la base |
| **Veille protectrice** | Un onglet qui contient du texte non envoyé (brouillon) ou un outil « gardé éveillé » (Réglages, avec son coût en Mo) n'est jamais endormi. Le contenu des champs n'est jamais lu, seulement « vide ou non » |
| **Retour et signaux** | **Ctrl+Tab** : client précédent (aller-retour) · **Alt+J** : prochain signal (son, connexion demandée, puis le plus ancien changement) |
| **Carnet du client** | **Ctrl+Maj+N** : note en une ligne (lien vers la page en option) ; Ctrl+Entrée la définit comme *prochaine action*, proposée par Ctrl+Maj+N (elle n'est plus affichée dans la barre). Stocké en clair sur l'ordinateur, jamais envoyé, jamais inclus dans un partage (Réglages › Carnets) |
| **Depuis votre départ** | Au retour après 10 min ou plus, le volet des clients s'ouvre seul et une carte dit « Absent depuis 2 h 14 » et liste ce qui a bougé ; elle disparaît seule, à la première frappe ou au clic. Les outils endormis sont comptés à part (« non vérifiés ») |
| **Ctrl+K** | Liste plate « Client › Outil » : `ac co` ouvre Acme › Compta, `compta` liste la Compta de chaque client. Chaque ligne annonce l'état avant d'agir (chaud/froid, +3, brouillon…). Classement par habitudes locales (effaçable dans Réglages › Carnets) |
| **Navigation en croix** | **Alt+1…9** : outil n° n du client · **Alt+↑ / ↓** : même outil (même « famille », réglable) chez le client précédent/suivant |
| **Mode vitrine** | **Ctrl+Maj+H** (ou proposé avant un partage d'écran) : les autres clients deviennent « Client 2 », « Client 3 », côté processus principal. Ne masque pas les pages ni les titres d'onglets |

Raccourcis : Ctrl+1…9 client · Ctrl+K aller à… · Ctrl+Tab client précédent · Alt+J prochain signal · Alt+1…9 / Alt+↑↓ navigation en croix · Ctrl+Maj+N note · Ctrl+Maj+H vitrine · Ctrl+T / Ctrl+W / Ctrl+L onglet · Ctrl+Maj+L remplir un mot de passe · Ctrl+, réglages. Les extensions déclarent leurs propres raccourcis (`chrome.commands`) et restent prioritaires. Ctrl+Alt n'est jamais utilisé (AltGr sur AZERTY).

## Fonctionnalités

| Domaine | Où |
| --- | --- |
| Clients et outils gérés depuis l'interface, persistés dans `junr-data.json` ; `config.json` ne sert que de valeurs initiales | Réglages › Clients et outils |
| Une partition `persist:client-<id>` par client, une `persist:global` pour les outils communs | `src/sessions.js` |
| **Extensions** : installation par ID du Web Store, chargement dans toutes les partitions, activation, mises à jour (empreinte SHA-256 vérifiée), compatibilité signalée à l'installation, icône / popup / clic droit / panneau latéral dans la barre | `src/extensions/` · Réglages › Extensions |
| **Pont d'API `chrome.*`** : ~25 espaces de noms implémentés (windows, tabs, cookies, contextMenus, notifications, commands, webNavigation, downloads, identity, history, bookmarks, sidePanel, userScripts, desktopCapture/tabCapture, messagerie native, omnibox…) | `src/extensions/bridge/` · **`docs/api-bridge.md`** |
| Permissions des sites (caméra, micro, position, notifications…) par site et par client ; partage d'écran avec sélecteur | `src/permissions.js`, `src/displaymedia.js` |
| Mise en veille : délai, exclusions par site, seuil de RAM | Réglages › Mise en veille |
| Navigation rapide, menu contextuel des pages, téléchargements automatiques, historique par client | `src/tabs.js`, `src/contextmenu.js` · Réglages › Téléchargements et historique |
| Fonctions natives : blocage réseau, injection de CSS/scripts, mots de passe chiffrés remplis à la demande | Réglages › Fonctions natives |
| **Partage d'un espace** : paquet `.junrshare` chiffré (X25519 + AES-256-GCM) et **signé** (Ed25519), test de portabilité par outil, expiration, usage unique, journal ; transport par fichier **ou par le relais** | `src/share.js`, `src/relay.js`, `server/` · Réglages › Partage |
| **Publication et mises à jour** : installeur Windows par Releases GitHub, mise à jour automatique en arrière-plan (installée à la fermeture), canaux stable et bêta, montée d'Electron/Chromium automatique par Dependabot quand les tests passent | `src/updater.js`, `.github/`, **`docs/RELEASES.md`** · Réglages › À propos |
| Sécurité : `contextIsolation`, `sandbox`, pas de `nodeIntegration` sur toutes les vues (testé) ; API d'administration réservée aux pages internes ; `npm run check:electron` | `src/ipc.js`, `docs/ELECTRON-UPDATES.md` |

## Mesures et diagnostics

| Commande | Produit |
| --- | --- |
| `npm run phase0:probe` | API `chrome.*` réellement exposées par Electron nu → `docs/electron-api-surface.md` |
| `npm run phase0` | compatibilité du corpus du Web Store **avec le pont** → `docs/phase0-report.md` (réseau requis) ; `JUNR_NO_SHIM=1 npm run phase0` : Electron nu → `docs/phase0-report-sans-pont.md` |
| `npm run phase0:persistence` | extension, stockage d'extension et cookies conservés après redémarrage complet |
| `npm run measure:ram` | RAM avec 5 clients × 8 onglets, avant/après mise en veille → `docs/ram-measure.md` |
| `npm run check:electron` | version d'Electron : correctifs de sécurité, retard sur la dernière stable |
| `EXT_ID=<id> node scripts/debug-sw.js` | s'attache au service worker d'une extension dès son démarrage (DevTools) et affiche pile et code des exceptions |
| `JUNR_ONLY="motif" npm test` | ne lance que les sections de test dont le titre correspond |

## Résultat de la Phase 0

Corpus de 24 extensions du Web Store : **Electron nu 2/24 (8,3 %)**, **avec le pont 23/24 (95,8 %)**, une extension (Dashlane) à vérifier avec un compte. **Le seuil du plan (99 %) n'est donc pas atteint à la lettre**, et rien n'a été validé de bout en bout avec de vrais comptes. Détail, méthode, limites et décisions : `docs/phase0-conclusion.md`.

## Limites connues

- Les validations qui exigent des comptes ou outils réels restent à faire (`docs/phase0-manual-checklist.md`) : connexion persistante des gestionnaires de mots de passe, partage avec un outil réel, efficacité des bloqueurs.
- Application non signée (usage interne) : Windows peut avertir à la première installation. Pas de version macOS ni Linux construite.
- Le pont est du code à maintenir : à chaque version d'Electron, relancer `npm test` et `npm run phase0` (`docs/ELECTRON-UPDATES.md`).
- `omnibox` sans liste de suggestions ; `tabCapture.capture` impossible (voie MV3 seulement) ; `pageCapture`, `debugger`, `gcm` non pris en charge.
- Le relais de partage (`server/relay.js`) est prêt mais **non hébergé** ; l'expéditeur d'un paquet est authentifié par sa signature, le destinataire en confirme l'empreinte à la première réception.
- Pas de DRM Widevine ni de synchronisation de compte Google. L'URL de téléchargement des CRX n'est pas une API garantie et les conditions du Chrome Web Store ne prévoient pas l'usage hors Chrome.

## Structure

```
main.js               démarrage, modes automatiques (JUNR_TEST, JUNR_SCRIPT)
src/                  store, sessions, tabs, spaces, permissions, native, share, relay, dialog, contextmenu, displaymedia, ipc
src/extensions/       manager (Web Store), compat, popup, actions, shim, sw-shim + bridge/ (une API par fichier api-*.js)
server/               relais de partage (Node sans dépendance)
shell/                interface : barre du haut, volets au survol, dialogue, page Réglages
extensions/           extensions fournies avec l'application (démo)
test/                 smoke.js, fixtures, serveur de test, extensions de test (sonde, agent du pont), hôte natif de test
scripts/              phase0*, measure-ram, check-electron, debug-sw
docs/                 rapports générés et procédures
```
