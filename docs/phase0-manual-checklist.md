# Phase 0 — vérifications manuelles

L'automate (`npm run phase0`, `npm test`) établit qu'une extension se charge, que son arrière-plan démarre, que son popup s'affiche, que les API qu'elle déclare existent et se comportent comme décrit (`api-bridge.md`). Ce qui suit exige des comptes ou des applications réels et reste à faire à la main. **Aucune de ces cases n'est cochée à ce jour.**

## 1. Gestionnaires de mots de passe : la connexion persiste (critère du plan)

Pour **chaque** gestionnaire du corpus (Bitwarden, 1Password, LastPass, **Dashlane** — seul classé « à vérifier ») et **chaque** client testé (au moins deux) :

- [ ] Installer l'extension par son identifiant (Réglages › Extensions).
- [ ] Dans le client A : ouvrir le popup, se connecter au compte du gestionnaire.
- [ ] Dans le client B : se connecter (une connexion par client, le coffre cloud est le même).
- [ ] Quitter complètement l'application (pas seulement la fenêtre), la relancer.
- [ ] Client A puis B : le popup affiche le coffre **sans redemander** d'identifiants.
- [ ] Remplir un formulaire de connexion depuis l'extension (saisie automatique et menu contextuel).
- [ ] Enregistrer un nouvel identifiant depuis une page de connexion.
- [ ] Noter : fonctionne / fonctionne avec une fonction native / ne fonctionne pas.

Le mécanisme sous-jacent (stockage d'extension et cookies conservés après redémarrage) est vérifié automatiquement par `npm run phase0:persistence`.

## 2. Messagerie native avec une application de bureau

- [ ] 1Password (ou Bitwarden avec déverrouillage biométrique, KeePassXC-Browser) : l'extension se connecte à l'application de bureau installée. Si l'application n'a enregistré son hôte que pour Chrome ou Edge, il est trouvé aux emplacements standard ; sinon déposer le manifeste dans `<dossier de données>/NativeMessagingHosts/`.

## 3. Une extension par famille d'API (usage principal)

| Famille | Test manuel |
| --- | --- |
| Réseau | uBlock Origin Lite / AdBlock : une page chargée de publicités en affiche-t-elle moins qu'avec l'extension désactivée ? |
| Scripts utilisateur | Tampermonkey : installer un script utilisateur simple (`GM_setValue`, `GM_xmlhttpRequest`) et vérifier qu'il agit sur une page |
| Content scripts | Dark Reader assombrit-il une page ? |
| Onglets et fenêtres | Session Buddy / OneTab voient-ils les onglets du client (et seulement les siens) ? |
| Cookies | Cookie-Editor liste-t-il ceux du client affiché (et seulement les siens) ? |
| Capture | GoFullPage produit-elle une image ? Loom enregistre-t-il l'écran ? |
| Téléchargements | Chrono Download Manager voit-il un téléchargement lancé depuis une page ? |
| Outils développeur | Les onglets React/Redux apparaissent-ils dans DevTools ? |
| Favoris | Raindrop.io enregistre-t-il un favori (les favoris sont communs à tous les clients) ? |
| Barre d'adresse | Un mot-clé d'extension (ex. Raindrop) déclenche-t-il l'extension à la validation ? (pas de liste de suggestions) |

## 4. Partage d'un espace — outil réel et relais

- [ ] Choisir un outil réel de Junr dont les conditions d'utilisation autorisent le partage de session.
- [ ] Déclarer son URL de contrôle (page de profil), tester la portabilité, exporter vers un second poste.
- [ ] Le destinataire importe et arrive connecté sans saisir d'identifiants.
- [ ] Si l'outil lie sa session à l'adresse IP ou à l'appareil, vérifier qu'il est bien signalé « non portable » chez le destinataire.
- [ ] Déployer le relais (`server/README.md`) derrière HTTPS, renseigner adresse et jeton dans Réglages › Partage, envoyer et récupérer un client par code de retrait ; vérifier que le second retrait échoue (410) et que le journal du relais enregistre les deux opérations.
- [ ] Première réception d'un expéditeur : l'empreinte affichée correspond à celle que l'expéditeur lit dans son Réglages › Partage.

## 5. Navigation courante

- [ ] Partage d'écran dans une visioconférence (Meet, Teams, Zoom web) : le sélecteur apparaît, le flux est reçu par les autres participants.
- [ ] Téléchargement d'un fichier depuis un outil : le fichier arrive dans Téléchargements, listé dans Réglages.
- [ ] Menu contextuel d'une page : copier/coller, ouvrir un lien dans un nouvel onglet, entrées des extensions.
