# Phase 0 et fin de Phase 1 — conclusions

Mesures du 25 octobre 2026 sur Electron 45.0.0 (Chromium 156), Windows 11, 16 cœurs, 23 Go de RAM. Rapports détaillés : `phase0-report.md` (avec le pont), `phase0-report-sans-pont.md` (Electron nu), `electron-api-surface.md`, `ram-measure.md`. Tout se relance avec les commandes du README.

## 1. Résultat de la Phase 0

Corpus : 24 extensions du Chrome Web Store, **toutes installées par identifiant** dans deux partitions. Même harnais, deux configurations :

| Configuration | Fonctionne | À vérifier | Ne fonctionne pas | Taux (fonctionne ou fonction native) | Borne haute |
| --- | --- | --- | --- | --- | --- |
| Electron nu (`JUNR_NO_SHIM=1`) | 2 | 1 | 19 | **8,3 %** (2/24) | 20,8 % |
| **Avec le pont d'API de Junr Browser** | **23** | 1 | **0** | **95,8 %** (23/24) | 100 % |

- Le seuil du plan est **99 %, soit 24 sur 24 ici : il n'est pas atteint à la lettre**. L'écart est **Dashlane**, classé « à vérifier » : son service worker démarre, ses API sont toutes présentes, mais il consigne des exceptions internes (`apiEvents[name]` indéfini, avant toute connexion). Analyse faite avec `scripts/debug-sw.js` : l'exception vient d'un appel de suivi (`getCommonAppSetting('installationId')`) émis avant que le module interne « carbon » de Dashlane ait enregistré ses commandes, c'est-à-dire une course dans le démarrage de l'extension, sans API navigateur en cause ; les autres exceptions au démarrage sont des sondes de fonctionnalités des bibliothèques embarquées, interceptées par elles. Je ne peux pas prouver cette course inoffensive sans compte : seul un essai connecté tranche. Indice favorable : le popup de Dashlane s'affiche correctement hors connexion (« Connexion / Créer un compte », vérifié avec `scripts/spike-popup.js`, comme celui de Bitwarden), donc le dialogue popup ↔ arrière-plan fonctionne ; cela ne prouve pas la connexion persistante.
- « Fonctionne » signifie, pour l'automate : l'extension s'installe, se charge dans chaque partition, son arrière-plan démarre, son popup s'affiche sans erreur de script, **toutes les API qu'elle déclare sont implémentées** (et testées une à une), aucune exception d'API manquante. **Ce n'est pas une validation de bout en bout** : connexion à un compte, remplissage, blocage effectif, etc. restent à vérifier à la main (`phase0-manual-checklist.md`).
- Le garde-fou du plan (« sous le seuil, le fork de Chromium est remis à l'étude ») a donc, à la lettre, été déclenché. Mon avis : **ne pas rouvrir le fork avant la validation manuelle des gestionnaires de mots de passe** ; si Bitwarden, 1Password, LastPass et Dashlane tiennent leur connexion après redémarrage, le pont couvre l'exigence 4 du plan sans fork.

## 2. Ce qu'il a fallu construire (et pourquoi)

Electron nu échouait pour une raison simple : la plupart des service workers d'extensions plantent au premier tour en branchant un écouteur sur une API absente (`chrome.contextMenus.onClicked`, `commands`, `windows`, `webNavigation`…). Le chiffrage demandé par la Phase 0 (étape 4) a été fait **en le construisant** : `src/extensions/bridge/`, documenté dans **`docs/api-bridge.md`** (couverture par API, limites, modèle de sécurité). Environ 25 espaces de noms, **200 contrôles automatiques dans les sections « Pont d'API »** (364 au total pour toute la suite).

Ce que la mesure a révélé en chemin, et que le plan ne prévoyait pas :

- **Electron n'émet aucun événement d'onglet ni `runtime.onInstalled`** : sans eux, des extensions n'initialisent jamais leurs menus ni leurs réglages. Le pont les émet (le cycle de vie `install`/`update`/`startup` est émulé).
- **Chromium ré-installe ses liaisons natives (`chrome.tabs`, `chrome.management`…) après le démarrage** et écrase tout correctif posé sur `chrome` : le pont remplace `chrome` et `browser` (deux objets distincts) par des proxys.
- **`tabs.query({ currentWindow: true })` renvoie `[]` dans Electron** (cause de l'échec de LastPass) ; **le User-Agent contenait `Electron/45`**, ce qui faisait prendre à LastPass un chemin « application de bureau » : l'application annonce désormais un User-Agent de navigateur (aussi nécessaire à la connexion à certains sites).
- **La messagerie native est « désactivée par l'administrateur »** : implémentée (manifestes d'hôte aux emplacements de Chrome, `allowed_origins`, protocole stdio) et testée avec un hôte réel ; l'arrêt du processus hôte à `port.disconnect()` est vérifié.
- **Le partage d'écran (`getDisplayMedia`) échouait dans toute page web** : un sélecteur d'écran/fenêtre a été ajouté (bénéfice produit, hors extensions).
- Un événement envoyé à l'instant où un service worker se déclare prêt peut être perdu : livraison différée de 100 ms (corrigeait un échec reproductible).

Coût de possession à ne pas sous-estimer : ce pont est du code à maintenir. À **chaque version d'Electron** : `npm test`, `npm run phase0:probe`, `npm run phase0` (voir `ELECTRON-UPDATES.md`) ; une évolution du mécanisme de liaison des API de Chromium peut le casser — la suite de tests est le filet.

## 3. Ce qui est vérifié, ce qui ne l'est pas

**Vérifié automatiquement** (`npm test`, 364 contrôles ; `npm run phase0:persistence`) — tout ce qui figurait dans la version précédente de ce document, plus : le pont d'API (windows, tabs, cookies, management, contextMenus avec menu réel, notifications, commands, action, sidePanel, webNavigation, downloads, identity, history, bookmarks, sessions, search, privacy, browsingData, userScripts avec mondes et messagerie, desktopCapture/tabCapture avec flux vidéo réels, omnibox, fontSettings, messagerie native), l'isolation entre clients des API, le contrôle des permissions d'API et d'hôte, **le relais de partage** (authentification, usage unique, expiration, taille, journal, destinataire erroné, chiffrement de bout en bout) et **la signature de l'expéditeur**.

**Non vérifié, à faire** :
- Connexion persistante d'un vrai gestionnaire de mots de passe après redémarrage, dans chaque client (compte requis) ; **Dashlane** en particulier (§1).
- Partage d'un espace avec **un outil réel** (critère d'acceptation du plan) ; les conditions d'utilisation de chaque outil.
- Efficacité réelle de uBlock Origin Lite / AdBlock (blocage effectif sur une page chargée de publicités) et de Tampermonkey (messagerie des scripts utilisateur sur ses propres scripts).
- Intégration de la messagerie native avec les applications de bureau réelles (1Password, KeePassXC) : testée avec un hôte de test, pas avec les leurs.
- `omnibox` : les suggestions renvoyées par l'extension ne sont pas affichées (pas de liste déroulante dans la barre d'adresse) ; `tabCapture.capture` (flux direct) impossible, seule la voie MV3 `getMediaStreamId` existe.
- Le relais est du code prêt à déployer (`server/README.md`) mais **n'est pas hébergé** : adresse HTTPS, jetons et supervision sont à décider.

## 4. RAM (fin de Phase 1)

5 clients × 8 onglets de pages publiques, mémoire privée des processus :

| Étape | Processus | RAM |
| --- | --- | --- |
| Application seule, sans onglet | 5 | **321 Mo** (surcoût fixe) |
| 40 onglets chargés | 44 | 2 815 Mo |
| Après mise en veille (1 client actif, 8 onglets) | 12 | 795 Mo (**−72 %**) |

Les pages mesurées sont légères ; avec de vrais outils SaaS le gain est plus grand (`JUNR_MEASURE_URLS`). Le surcoût fixe de 321 Mo répond à la question « Electron est-il acceptable ? » : à votre appréciation.

## 5. Décisions qui vous reviennent

1. **Valider à la main les gestionnaires de mots de passe** (4 comptes de test) : c'est ce qui tranche entre « le pont suffit » et « rouvrir le fork ».
2. **Licence d'`electron-chrome-extensions`** : plus nécessaire pour la couverture mesurée ; la question ne se repose que si vous préférez maintenir moins de code propre.
3. **Héberger le relais** (HTTPS, jetons par collaborateur, qui administre le journal) et **choisir l'outil réel** pour la première validation du partage.
4. **Politique de mise à jour d'Electron** : le pont impose la discipline décrite au §2.
