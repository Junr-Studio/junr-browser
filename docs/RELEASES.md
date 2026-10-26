# Publication et mises à jour

Junr Browser est distribué par les **Releases GitHub** du dépôt. Pas de signature de code : l'application est interne (Windows peut afficher « éditeur inconnu » à la première installation).

## Le circuit

```
Dependabot ──► pull request « bump electron »
                   │  ci.yml : check:electron + npm test + construction de l'installeur
                   ▼
            fusion automatique (sauf nouvelle version MAJEURE d'Electron)
                   │  release.yml : version +1 (patch), tag vX.Y.Z, construction, tests, publication
                   ▼
        Release GitHub « pré-version »  ──►  canal bêta : reçue tout de suite
                   │  promote.yml : tous les jours, passe la dernière pré-version en stable
                   ▼                        après 3 jours sans retrait
        Release GitHub « stable »       ──►  canal stable : reçue par tout le monde
```

- **Electron / Chromium** : Dependabot propose chaque version. Patch et mineure : tout est automatique si les tests passent. Une **majeure** reste en pull request, à relire (voir `docs/ELECTRON-UPDATES.md`).
- **Autres dépendances** (`electron-builder`, `electron-updater`, actions GitHub) : pull request à relire, jamais fusionnées seules, car elles touchent la publication elle-même.
- **Version fonctionnelle** : *Actions → Release → Run workflow*, choisir patch, mineure ou majeure. Ou pousser un tag `vX.Y.Z` dont le numéro est celui de `package.json`.

## Retirer ou accélérer une version

| Besoin | Geste |
| --- | --- |
| Une pré-version est mauvaise | La **supprimer** (Releases → Delete), ou écrire `[hold]` dans sa description : elle n'est jamais promue. |
| La promouvoir tout de suite | *Actions → Promote → Run workflow*, avec son tag. |
| Changer le délai | *Actions → Promote → Run workflow*, `delay_days`, ou modifier la valeur par défaut dans `promote.yml`. |

Une version déjà promue puis reconnue mauvaise : publier une version corrective (patch). L'application ne revient jamais en arrière toute seule.

## Côté application (`src/updater.js`)

- Vérification 20 s après le démarrage, puis toutes les 4 h.
- Téléchargement en arrière-plan ; **installation à la fermeture** (ou sur « Redémarrer » dans le volet des clients et dans Réglages → À propos). Jamais au milieu du travail.
- Canal choisi dans Réglages → À propos : *Stable* (releases publiées) ou *Bêta* (pré-versions comprises).
- Journal : `updater.log` dans le dossier de données de l'application (`%APPDATA%\junr-browser`).
- En développement (`npm start`) : désactivé. `JUNR_UPDATE_URL=http://hôte:port` pointe l'application vers un dossier contenant `latest.yml` et l'installeur (essais, ou serveur maison).

## Construire à la main

```
npm run dist:dir    # dossier dist/win-unpacked, sans installeur (rapide)
npm run dist        # installeur Windows dans dist/, sans publier
```

Le dossier de données (`%APPDATA%\junr-browser` : clients, sessions, extensions) n'est jamais touché par une mise à jour ni par une désinstallation.

## Avant de rendre le dépôt à d'autres mains

- Jamais de jeton ni de clé dans le dépôt : la publication utilise le `GITHUB_TOKEN` fourni par GitHub Actions, rien d'autre.
- Les captures et pistes de design (`docs/design/`, `docs/shots/`) sont exclues du dépôt (`.gitignore`).
