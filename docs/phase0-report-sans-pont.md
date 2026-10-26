# Phase 0 — compatibilité des extensions du Chrome Web Store

Généré par `npm run phase0` le 2026-10-25T19:34:43.185Z — Electron 45.0.0 (Chromium 156.0.8078.48). **Configuration : Electron nu, sans pont (JUNR_NO_SHIM=1).**

## Résultat

- Corpus : 24 extensions, 24 installées par ID depuis le Web Store, 0 non installées (identifiant introuvable ou erreur — voir le tableau).
- **Fonctionne** : 2 · **Fonctionne avec une fonction native** : 0 · **Dégradée** : 2 · **À vérifier à la main** : 1 · **Ne fonctionne pas** : 19
- **Taux de réussite (fonctionne + fonction native) : 8.3 %** — seuil du plan : 99 %. **Seuil NON atteint.**
- Borne haute (tout sauf « ne fonctionne pas » : on suppose que « à vérifier » et « dégradée » fonctionnent) : 5/24 = **20.8 %**. La vérité fonctionnelle est entre les deux bornes ; seul l'essai manuel tranche.

> Garde-fou du plan : sous le seuil, le fork de Chromium (seule voie qui garantit toutes les extensions) est remis à l'étude. Voir la section « Que faire de ce résultat ».

## Méthode et limites

- Installation par ID via l'URL de mise à jour publique, chargement dans deux partitions (Client A, Client B), démarrage du service worker, ouverture du popup, comparaison d'une page de test avant/après.
- Ce test est **automatique et statique-dynamique** : il établit qu'une extension se charge, que son arrière-plan démarre, que son popup s'affiche sans erreur de script et que les API qu'elle déclare existent dans Electron (voir `docs/electron-api-surface.md`). Il ne prouve pas qu'elle fonctionne de bout en bout : la validation fonctionnelle (connexion à un compte, remplissage, capture…) reste manuelle — voir `docs/phase0-manual-checklist.md`.
- « Dégradée » = seules des API de confort manquent (menus contextuels, raccourcis, notifications…) ; elle n'est **pas** comptée dans le taux. Le classement des API « de confort » est un jugement à confirmer extension par extension.
- Le taux se calcule sur les extensions installées. Une extension non installée ne prouve rien sur Electron.

## Tableau de compatibilité

| Extension | Familles d'API | MV | Verdict | API absentes d'Electron | Détail d'exécution |
| --- | --- | --- | --- | --- | --- |
| uBlock Origin Lite | Réseau (declarativeNetRequest) ; MV3 | 3 | Ne fonctionne pas | userScripts, commands<br>bloquant : userScripts | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onCommand') ») ; popup : ok ; effet sur une page : aucun visible |
| AdBlock (AdBlock — block ads across the web) | Réseau (webRequest, declarativeNetRequest) | 3 | Ne fonctionne pas | contextMenus, notifications, webNavigation<br>bloquant : webNavigation | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onBeforeNavigate') ») ; popup : ok ; effet sur une page : aucun visible |
| Bitwarden (Bitwarden Password Manager) | Stockage et identité ; Messagerie native ; MV3 : offscreen, alarms | 3 | Ne fonctionne pas | contextMenus, sidePanel, webNavigation, notifications, commands<br>bloquant : sidePanel, webNavigation | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onCommitted') ») ; popup : 1 erreur(s) de script ; effet sur une page : aucun visible |
| 1Password (1Password – Password Manager) | Stockage et identité ; Messagerie native | 3 | Ne fonctionne pas | contextMenus, downloads, management, nativeMessaging, notifications, privacy, webNavigation, commands<br>remplaçable : nativeMessaging → remplissage de mots de passe intégré ; bloquant : downloads, management, privacy, webNavigation | chargée A/B : oui/oui ; service worker : ne démarre pas ; 4 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onClicked') ») ; popup : ok ; effet sur une page : aucun visible |
| LastPass (LastPass: Free Password Manager) | Stockage et identité ; Cookies | 3 | Ne fonctionne pas | notifications, contextMenus, webNavigation, cookies, omnibox<br>bloquant : webNavigation, cookies | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onFocusChanged') ») ; popup : ok ; effet sur une page : aucun visible |
| Dashlane (Dashlane — Password Manager) | Stockage et identité ; Interface | 3 | Ne fonctionne pas | contextMenus, cookies, privacy, commands<br>bloquant : cookies, privacy | chargée A/B : oui/oui ; service worker : démarre ; 2 erreur(s) dans le service worker (« [background/autofill-engine] Exception while starting autofill-engine [object Object] ») ; popup : ok ; effet sur une page : aucun visible |
| Dark Reader | Content scripts et scripting ; MV3 | 3 | À vérifier à la main (exceptions internes du service worker) | fontSettings, commands | chargée A/B : oui/oui ; service worker : démarre ; 6 erreur(s) dans le service worker (« "sync" is not available in this instance of Chrome ») ; popup : ok ; effet sur une page : oui |
| Tampermonkey | Content scripts et scripting ; Réseau (webRequest) | 3 | Ne fonctionne pas | notifications, webNavigation, contextMenus, cookies, userScripts, commands<br>bloquant : webNavigation, cookies, userScripts | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Vimium | Interface (commands) ; Onglets et fenêtres | 3 | Ne fonctionne pas | bookmarks, history, sessions, notifications, webNavigation, search<br>bloquant : bookmarks, history, webNavigation | chargée A/B : oui/oui ; service worker : ne démarre pas ; 4 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onHistoryStateUpdated') ») ; popup : ok ; effet sur une page : aucun visible |
| Session Buddy (Session Buddy - Tab & Bookmark Manager) | Onglets et fenêtres | 3 | Dégradée (fonction secondaire perdue) | commands | chargée A/B : oui/oui ; service worker : démarre ; effet sur une page : aucun visible |
| OneTab | Onglets et fenêtres ; Stockage | 3 | Ne fonctionne pas | contextMenus, commands, omnibox | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onCommand') ») ; popup : ok ; effet sur une page : aucun visible |
| Cookie-Editor | Cookies | 3 | Ne fonctionne pas | cookies, sidePanel<br>bloquant : cookies, sidePanel | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onChanged') ») ; popup : ok ; effet sur une page : aucun visible |
| React Developer Tools | Outils développeur | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Redux DevTools | Outils développeur | 3 | Ne fonctionne pas | notifications, contextMenus, commands | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onClicked') ») ; popup : ok ; effet sur une page : aucun visible |
| GoFullPage (GoFullPage - Full Page Screen Capture) | Capture et fichiers | 3 | Dégradée (fonction secondaire perdue) | commands | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Loom (Loom – Screen Recorder & Screen Capture) | Capture et fichiers (tabCapture, desktopCapture) | 3 | Ne fonctionne pas | contextMenus, cookies, desktopCapture, tabCapture, webNavigation, commands<br>bloquant : cookies, desktopCapture, tabCapture, webNavigation | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onRemoved') ») ; popup : ok ; effet sur une page : aucun visible |
| Chrono Download Manager | Capture et fichiers (downloads) | 3 | Ne fonctionne pas | contextMenus, downloads, notifications<br>bloquant : downloads | chargée A/B : oui/oui ; service worker : ne démarre pas ; 4 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onClicked') ») ; popup : ok ; effet sur une page : aucun visible |
| Raindrop.io | Historique et favoris ; Interface | 3 | Ne fonctionne pas | contextMenus, sidePanel, commands, omnibox<br>bloquant : sidePanel | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onCommand') ») ; popup : ok ; effet sur une page : aucun visible |
| Notion Web Clipper | Stockage et identité (identity) ; Interface (contextMenus) | 3 | Ne fonctionne pas | cookies, commands<br>bloquant : cookies | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Google Traduction (Google Translate) | Interface (contextMenus, action) | 3 | Ne fonctionne pas | contextMenus | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onClicked') ») ; popup : ok ; effet sur une page : aucun visible |
| Grammarly (Grammarly: AI Writing Assistant and Grammar Checker App) | Content scripts et scripting ; Stockage et identité | 3 | Ne fonctionne pas | sidePanel, notifications, cookies, identity<br>bloquant : sidePanel, cookies, identity | chargée A/B : oui/oui ; service worker : démarre ; 14 erreur(s) dans le service worker (« grm ERROR [lib.tracking.telemetry] ░░ bg.unhandledException [object Object] Error: Cannot  ») ; popup : ok ; effet sur une page : oui |
| Wappalyzer (Wappalyzer - Technology profiler) | Réseau (webRequest) ; Onglets (webNavigation) | 3 | Ne fonctionne pas | cookies<br>bloquant : cookies | chargée A/B : oui/oui ; service worker : démarre ; 4 erreur(s) dans le service worker (« TypeError: chrome.tabs.create is not a function ») ; popup : ok ; effet sur une page : aucun visible |
| JSONVue | Content scripts et scripting | 3 | Ne fonctionne pas | contextMenus | chargée A/B : oui/oui ; service worker : ne démarre pas ; 2 erreur(s) dans le service worker (« Uncaught TypeError: Cannot read properties of undefined (reading 'onClicked') ») ; effet sur une page : aucun visible |
| Momentum | Interface (chrome_url_overrides) | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; effet sur une page : aucun visible |

## API les plus souvent manquantes

- `commands` : 13 extension(s)
- `contextMenus` : 13 extension(s)
- `notifications` : 9 extension(s)
- `cookies` : 8 extension(s)
- `webNavigation` : 7 extension(s)
- `sidePanel` : 4 extension(s)
- `omnibox` : 3 extension(s)
- `userScripts` : 2 extension(s)
- `downloads` : 2 extension(s)
- `privacy` : 2 extension(s)
- `management` : 1 extension(s)
- `nativeMessaging` : 1 extension(s) — remplaçable par remplissage de mots de passe intégré
- `fontSettings` : 1 extension(s)
- `bookmarks` : 1 extension(s)
- `history` : 1 extension(s)
- `sessions` : 1 extension(s)
- `search` : 1 extension(s)
- `desktopCapture` : 1 extension(s)
- `tabCapture` : 1 extension(s)
- `identity` : 1 extension(s)

## Que faire de ce résultat

Voir la section correspondante de `docs/phase0-conclusion.md` (rédigée à partir de ce rapport).
