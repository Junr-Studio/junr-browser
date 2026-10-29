# Pont d'API `chrome.*`

Electron n'implémente qu'une partie des API d'extensions (mesure : `electron-api-surface.md`). Le pont de Junr Browser (`src/extensions/bridge/`) implémente le reste dans le processus principal et l'expose aux extensions ; **chaque API ci-dessous a un test automatique** (`test/smoke.js`, sections « Pont d'API »).

## Fonctionnement

```
extension (service worker ou page) ─ chrome.X.méthode() ─► shim (sw-shim.js) ─► __junr.invoke ─► bridge/index.js ─► bridge/api-X.js
api-X.js ─ emit('X.onÉvénement') ─► conn.send ─► shim ─► écouteurs de l'extension
```

- **Service workers** : à chaque chargement d'une extension installée, son service worker est enveloppé (`junr-sw.js` charge `junr-shim.js` puis le script d'origine) ; un préchargement `service-worker` expose `__junr`.
- **Pages d'extension** (popup, options, panneau latéral) : le même shim est injecté par un préchargement `frame`.
- **`chrome` et `browser`** sont remplacés par des proxys qui résolvent chaque espace de noms à chaque accès (Chromium ré-installe ses liaisons natives après le démarrage et écraserait un simple patch).
- **Autorisation** : chaque appel est contrôlé dans le processus principal d'après le **manifeste** de l'extension, identifiée par la portée de son service worker ou l'URL de sa frame — jamais d'après les arguments. Permissions d'API et permissions d'hôte sont vérifiées comme dans Chrome.
- **Isolation des clients** : une extension tourne dans une instance par client ; elle ne voit que les onglets, cookies, téléchargements et historique de son client. Les favoris sont communs (plan : « favoris communs par les fonctions natives »).
- **Événements** : livrés aux extensions abonnées ; si leur service worker dort, il est réveillé et l'événement livré à son signal « prêt » (`startWorkerForScope`).
- **Cycle de vie émulé** : `runtime.onInstalled` (`install` / `update` + `previousVersion`) et `runtime.onStartup`, que Electron n'émet jamais.

## Couverture

| Espace de noms | État | Remarques |
| --- | --- | --- |
| `windows` | implémenté | une fenêtre (identifiant 0, comme Electron) ; `create` ouvre des onglets ; `remove` refusé |
| `tabs` | implémenté + natif | `query`, `get`, `create`, `update`, `remove`, `reload`, `goBack/Forward`, `duplicate`, `getCurrent`, `captureVisibleTab`, zoom, tous les événements. `sendMessage` et `scripting.executeScript` restent natifs (même identifiant d'onglet = `webContents.id`). `group`, `ungroup` : inertes |
| `action` | implémenté + natif | `onClicked`, `openPopup` ; clic droit sur l'icône (menu `contexts: ['action']`) |
| `cookies` | implémenté | partition du client ; permission « cookies » **et** hôte |
| `management` | implémenté | `getSelf` libre ; `setEnabled`/`uninstall` sur les extensions installées |
| `contextMenus` | implémenté | menu contextuel des pages (entrées du navigateur + extensions) ; sous-menus, cases, radios, `%s`, motifs d'URL |
| `notifications` | implémenté | notifications du système ; boutons, clics, fermeture |
| `commands` | implémenté | raccourcis du manifeste, `_execute_action` |
| `webNavigation` | implémenté | tous les événements, cadres imbriqués, filtres d'URL |
| `downloads` | implémenté | tout téléchargement est enregistré dans Téléchargements (sans dialogue, nom unique) ; liste dans Réglages |
| `identity` | partiel | `launchWebAuthFlow`, `getRedirectURL` ; `getAuthToken` non disponible (pas de compte Google) |
| `history`, `topSites` | implémenté | historique par client (`history.json`), désactivable, effaçable |
| `bookmarks` | implémenté | arbre commun à tous les clients, dans le store |
| `sidePanel` | implémenté | panneau ancré à droite (380 px) |
| `userScripts` | implémenté | `register/update/unregister/getScripts`, `configureWorld` ; mondes `MAIN` et `USER_SCRIPT` (isolé), messagerie `chrome.runtime.sendMessage` + `onUserScriptMessage`, `runAt`, `allFrames`, `excludeMatches` |
| `desktopCapture`, `tabCapture` | partiel | `chooseDesktopMedia` (sélecteur) et `tabCapture.getMediaStreamId` + `getUserMedia` ; `tabCapture.capture` impossible à travers le pont |
| `runtime` (ajouts) | implémenté | `openOptionsPage`, `sendNativeMessage`, `connectNative`, `onInstalled`, `onStartup`, `onUserScriptMessage` |
| messagerie native | implémenté | manifestes d'hôte aux emplacements de Chrome/Edge/Chromium (+ `userData/NativeMessagingHosts`), `allowed_origins`, protocole stdio à longueur préfixée |
| `omnibox` | partiel | mot-clé + espace dans la barre d'adresse : `onInputStarted/Changed/Entered/Cancelled` ; **pas de liste de suggestions affichée** |
| `fontSettings` | partiel | liste des polices du système ; réglages mémorisés, sans effet sur le rendu |
| `sessions` | implémenté | onglets fermés récemment, `restore` |
| `search` | implémenté | recherche Google |
| `privacy` | partiel | réglages mémorisés ; seule `network.webRTCIPHandlingPolicy` a un effet réel |
| `browsingData` | partiel | `since` n'est honoré que pour l'historique |
| `storage.sync` | alias | devient `storage.local` (pas de synchronisation entre appareils) |

**Natifs Electron, inchangés** : `runtime` (reste), `storage`, `alarms`, `scripting`, `declarativeNetRequest`, `webRequest`, `offscreen`, `permissions`, `idle`, `i18n`, `system.*`, `power`, `proxy`, `dns`.

**Non pris en charge** (la fonction échoue avec un message explicite) : `pageCapture`, `debugger`, `gcm`, `ttsEngine`, `printerProvider`.

**Inertes** (aucune erreur, aucun effet ; avertissement `[junr-shim]` dans la console du service worker) : `declarativeContent`, `tabGroups`, `readingList`, `contentSettings`, `tts`.

## Limites à connaître

- Un test automatique prouve qu'une API se comporte comme décrit, pas qu'une extension réelle fonctionne de bout en bout : voir `phase0-manual-checklist.md`.
- Les pages d'extension tournent avec le shim injecté au démarrage du document ; une extension qui capture `chrome` avant (rare) contournerait le pont.
- `tabCapture` / `getDisplayMedia` : Chromium ne capture pas une vue masquée ; le premier essai peut échouer juste après un changement d'onglet (le test réessaie).
- Les extensions fournies avec l'application (`extensions/`) n'ont pas de service worker enveloppé : elles n'en ont pas besoin.
- `npm run phase0:probe` mesure l'Electron **nu** ; `npm run phase0` mesure Electron **avec** le pont (`JUNR_NO_SHIM=1` pour comparer).
