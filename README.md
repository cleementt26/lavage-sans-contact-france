# Sans Contact — carte des lavages auto sans brosses

Application web statique, responsive et sans back-end pour trouver les stations françaises équipées d'un robot ou d'un portique automatique haute pression sans contact.

## Structure

```text
lavage-sans-contact/
├── index.html       Interface et balisage
├── styles.css       Design responsive
├── app.js           Carte, géolocalisation, itinéraire et filtre
├── stations.json    Base vérifiée des stations
├── SOURCES.md       Méthode, sources et limites
├── .nojekyll        Publication GitHub Pages sans traitement Jekyll
└── README.md        Installation et déploiement
```

## Fonctionnement

- Leaflet affiche les tuiles OpenStreetMap et les marqueurs issus de `stations.json`.
- La géolocalisation utilise l'API native du navigateur (HTTPS ou `localhost` requis).
- Les adresses de départ et d'arrivée sont géocodées avec Nominatim.
- Le trajet routier est demandé au serveur public OSRM, puis affiché dans Leaflet.
- Le filtre calcule côté client la distance minimale de chaque station à tous les segments du tracé. Il s'agit d'un corridor géométrique, pas du détour routier réel.

Les services publics Nominatim et OSRM conviennent à une démonstration ou un faible trafic. Pour un site très fréquenté, utilisez une instance dédiée ou un fournisseur respectant leurs politiques d'usage.

## Tester en local

Depuis le dossier du projet :

```bash
python3 -m http.server 8080
```

Ouvrir ensuite <http://localhost:8080>. Ne pas ouvrir directement `index.html` en `file://`, car le navigateur bloquerait le chargement de `stations.json`.

## Déployer sur GitHub Pages

1. Créer un nouveau dépôt GitHub, par exemple `lavage-sans-contact`.
2. Placer tous les fichiers de ce dossier à la racine du dépôt.
3. Exécuter :

```bash
git init
git add .
git commit -m "Initialisation de la carte des lavages sans contact"
git branch -M main
git remote add origin https://github.com/VOTRE-COMPTE/lavage-sans-contact.git
git push -u origin main
```

4. Dans GitHub : **Settings → Pages → Build and deployment → Deploy from a branch**.
5. Choisir la branche **main**, le dossier **/(root)**, puis **Save**.
6. Le site sera accessible sur `https://VOTRE-COMPTE.github.io/lavage-sans-contact/`.

## Mettre la base à jour

Ajouter ou modifier un objet dans `stations.json` avec les quatre champs obligatoires : `nom`, `adresse`, `latitude`, `longitude`. Conserver un `id` numérique unique pour l'interface. Vérifier explicitement que l'équipement automatique fonctionne sans brosses avant publication et ajouter sa preuve dans `SOURCES.md`.
