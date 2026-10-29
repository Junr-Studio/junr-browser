# Round 2 : performance

**Verdict : rouge pour le round suivant** (le reviewer écrit « Approuvé » avec un majeur ; un majeur interdit le vert). Les corrections du round 1 tiennent, mesures à l'appui : 100 cases cochées = 97 à 100 requêtes (au lieu de 1 962) ; 500 apps dont une en déploiement = 6 101 requêtes/h (au lieu de 60 000) ; réseau muet = relevé de 20 s et 4 requêtes (au lieu de 42 min) ; payload vers la barre 70 octets (au lieu de 95 Ko).

Majeur
- M1 : famine des dernières apps quand le budget de 45 s ne suffit pas (`apps × latence > 180 s`, soit 360 ms par requête à 500 apps) : le relevé complet repart toujours de la première app, les dernières restent « Délai dépassé » indéfiniment. Correctif : envoyer en premier les apps inconnues, puis les plus anciennement relevées.

Mineurs
- m1 : une demande reçue pendant le 3e tour est perdue jusqu'au prochain tick.
- m2 : les apps durablement inconnues sont relevées à chaque tick rapide (même cause que C1 en scalabilité).
- m3 : pas de disjoncteur sur les 5xx (même cause que C2).
