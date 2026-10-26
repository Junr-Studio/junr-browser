# Phase 0 — compatibilité des extensions du Chrome Web Store

Généré par `npm run phase0` le 2026-10-25T19:23:24.419Z — Electron 45.0.0 (Chromium 156.0.8078.48). **Configuration : avec le pont d'API (shim des service workers).**

## Résultat

- Corpus : 24 extensions, 24 installées par ID depuis le Web Store, 0 non installées (identifiant introuvable ou erreur — voir le tableau).
- **Fonctionne** : 23 · **Fonctionne avec une fonction native** : 0 · **Dégradée** : 0 · **À vérifier à la main** : 1 · **Ne fonctionne pas** : 0
- **Taux de réussite (fonctionne + fonction native) : 95.8 %** — seuil du plan : 99 %. **Seuil NON atteint.**
- Borne haute (tout sauf « ne fonctionne pas » : on suppose que « à vérifier » et « dégradée » fonctionnent) : 24/24 = **100 %**. La vérité fonctionnelle est entre les deux bornes ; seul l'essai manuel tranche.

> Garde-fou du plan : sous le seuil, le fork de Chromium (seule voie qui garantit toutes les extensions) est remis à l'étude. Voir la section « Que faire de ce résultat ».

## Méthode et limites

- Installation par ID via l'URL de mise à jour publique, chargement dans deux partitions (Client A, Client B), démarrage du service worker, ouverture du popup, comparaison d'une page de test avant/après.
- Ce test est **automatique et statique-dynamique** : il établit qu'une extension se charge, que son arrière-plan démarre, que son popup s'affiche sans erreur de script et que les API qu'elle déclare existent dans Electron (voir `docs/electron-api-surface.md`). Il ne prouve pas qu'elle fonctionne de bout en bout : la validation fonctionnelle (connexion à un compte, remplissage, capture…) reste manuelle — voir `docs/phase0-manual-checklist.md`.
- « Dégradée » = seules des API de confort manquent (menus contextuels, raccourcis, notifications…) ; elle n'est **pas** comptée dans le taux. Le classement des API « de confort » est un jugement à confirmer extension par extension.
- Le taux se calcule sur les extensions installées. Une extension non installée ne prouve rien sur Electron.

## Tableau de compatibilité

| Extension | Familles d'API | MV | Verdict | API absentes d'Electron | Détail d'exécution |
| --- | --- | --- | --- | --- | --- |
| uBlock Origin Lite | Réseau (declarativeNetRequest) ; MV3 | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| AdBlock (AdBlock — block ads across the web) | Réseau (webRequest, declarativeNetRequest) | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; 2 erreur(s) dans le service worker (« Error: [ipm]: No remote configuration. ») ; popup : ok ; effet sur une page : aucun visible |
| Bitwarden (Bitwarden Password Manager) | Stockage et identité ; Messagerie native ; MV3 : offscreen, alarms | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; 2 erreur(s) dans le service worker (« Uncaught (in promise) Error: Could not establish connection. Receiving end does not exist. ») ; popup : ok ; effet sur une page : aucun visible |
| 1Password (1Password – Password Manager) | Stockage et identité ; Messagerie native | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; 1 erreur(s) dans le service worker (« Uncaught (in promise) Error: WASM is not initialized, unable to make core call. ») ; popup : ok ; effet sur une page : aucun visible |
| LastPass (LastPass: Free Password Manager) | Stockage et identité ; Cookies | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Dashlane (Dashlane — Password Manager) | Stockage et identité ; Interface | 3 | À vérifier à la main (exceptions internes du service worker) | — | chargée A/B : oui/oui ; service worker : démarre ; 4 erreur(s) dans le service worker (« [background/framework] Error while processing incoming carbon-legacy.carbon command (id: 0 ») ; popup : ok ; effet sur une page : aucun visible |
| Dark Reader | Content scripts et scripting ; MV3 | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : oui |
| Tampermonkey | Content scripts et scripting ; Réseau (webRequest) | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Vimium | Interface (commands) ; Onglets et fenêtres | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Session Buddy (Session Buddy - Tab & Bookmark Manager) | Onglets et fenêtres | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; effet sur une page : aucun visible |
| OneTab | Onglets et fenêtres ; Stockage | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Cookie-Editor | Cookies | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| React Developer Tools | Outils développeur | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Redux DevTools | Outils développeur | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| GoFullPage (GoFullPage - Full Page Screen Capture) | Capture et fichiers | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Loom (Loom – Screen Recorder & Screen Capture) | Capture et fichiers (tabCapture, desktopCapture) | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : non ouvert ; effet sur une page : oui |
| Chrono Download Manager | Capture et fichiers (downloads) | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Raindrop.io | Historique et favoris ; Interface | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; 2 erreur(s) dans le service worker (« Uncaught (in promise) Error: URL invalide : /welcome/index.html ») ; popup : ok ; effet sur une page : aucun visible |
| Notion Web Clipper | Stockage et identité (identity) ; Interface (contextMenus) | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : aucun visible |
| Google Traduction (Google Translate) | Interface (contextMenus, action) | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; 1 erreur(s) dans le service worker (« Uncaught (in promise) Error: Could not establish connection. Receiving end does not exist. ») ; popup : ok ; effet sur une page : aucun visible |
| Grammarly (Grammarly: AI Writing Assistant and Grammar Checker App) | Content scripts et scripting ; Stockage et identité | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; 20 erreur(s) dans le service worker (« grm ERROR [extension-api.managed-storage.chrome] ░░ Could not get "GrammarlyExtensionMode" ») ; popup : ok ; effet sur une page : partiel |
| Wappalyzer (Wappalyzer - Technology profiler) | Réseau (webRequest) ; Onglets (webNavigation) | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; popup : ok ; effet sur une page : partiel |
| JSONVue | Content scripts et scripting | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; effet sur une page : aucun visible |
| Momentum | Interface (chrome_url_overrides) | 3 | Fonctionne | — | chargée A/B : oui/oui ; service worker : démarre ; 2 erreur(s) dans le service worker (« Uncaught (in promise) Error: URL invalide : index.html ») ; effet sur une page : aucun visible |

## API les plus souvent manquantes


## Que faire de ce résultat

Voir la section correspondante de `docs/phase0-conclusion.md` (rédigée à partir de ce rapport).
