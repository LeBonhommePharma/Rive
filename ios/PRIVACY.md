# Politique de confidentialité — Rive pour iOS / Privacy Policy — Rive for iOS

Dernière mise à jour / Last updated: 2026-09-28

Cette page doit être publiée à une adresse publique avant la soumission et cette adresse saisie dans App Store Connect (champ *Privacy Policy URL*). Adresse suggérée : `https://thebonhomme.com/transit/privacy/` — **TODO : confirmer que la page existe et que le dépôt apex la sert** (voir `DEPLOY.md`). Le texte ci-dessous décrit exactement ce que fait le code de `ios/RiveApp` et `native/RiveKit` ; si le code change, mettre à jour cette page et l'écran *Confidentialité* dans `ios/RiveApp/AboutView.swift`.

---

## Français

### Portée

Cette politique s'applique à l'application native **Rive** pour iPhone et iPad (identifiant `com.thebonhomme.rive`). Le site web Rive/Transit à `thebonhomme.com/transit/` peut utiliser d'autres services et n'est pas couvert par ce texte.

### En bref

- Aucun compte, aucune inscription.
- Aucune publicité, aucun outil d'analyse d'utilisation, aucun suivi (tracking), aucun identifiant publicitaire.
- Les recherches d'arrêts, le calcul des départs et les propositions de trajets se font entièrement sur votre appareil.
- La position est facultative, demandée seulement quand vous touchez **Autour de moi**, utilisée sur l'appareil et jamais enregistrée ni transmise par Rive.
- Nous ne recevons aucune donnée personnelle de l'application.

### Données conservées sur votre appareil

Rive enregistre localement, dans les préférences de l'application (UserDefaults) :

- vos **arrêts favoris** (identifiant de l'arrêt et ville) ;
- la **ville sélectionnée**.

Rive conserve aussi, dans le dossier de cache de l'application, la dernière copie des horaires publics téléchargés pour une ville (`atlas.json` et `timetable.json`), afin qu'ils restent consultables hors connexion.

Ces données ne quittent pas l'appareil. Elles sont incluses dans la sauvegarde iCloud ou iTunes/Finder de l'appareil selon vos réglages iOS, comme pour toute application.

### Localisation (facultative)

- Rive ne demande l'autorisation de localisation **que lorsque vous touchez « Autour de moi »** dans l'onglet Explorer (autorisation « Lorsque l'app est active » uniquement ; Rive ne demande jamais l'accès en arrière-plan).
- La précision demandée est d'environ 100 mètres.
- La position sert uniquement à centrer la carte et à afficher les arrêts proches. Elle n'est pas enregistrée, n'est pas conservée après la session, et n'est jamais transmise au serveur de données de Rive ni à qui que ce soit d'autre par Rive.
- Vous pouvez refuser ou révoquer l'autorisation dans Réglages > Confidentialité et sécurité > Service de localisation. L'application reste entièrement utilisable par recherche d'arrêt.

### Connexions réseau

L'application fonctionne hors connexion avec les horaires inclus. Elle établit des connexions réseau dans trois cas seulement :

1. **Actualiser les horaires** (bouton dans Explorer et dans À propos) : Rive télécharge `atlas.json` et `timetable.json` de la ville choisie depuis `https://thebonhomme.com/transit/data/`, un site statique hébergé par GitHub Pages. La requête ne contient ni recherche, ni favori, ni position GPS ; elle contient seulement les informations techniques de toute requête web (adresse IP, ressource demandée, identifiant système de l'application `User-Agent`). Nous n'exploitons pas ces journaux d'accès. GitHub décrit ses pratiques dans sa [déclaration générale de confidentialité](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
2. **Carte** : la carte de l'onglet Explorer et des détails de trajet est fournie par Apple MapKit. Les tuiles et requêtes cartographiques sont traitées par Apple selon la [politique de confidentialité d'Apple Plans](https://www.apple.com/legal/privacy/data/fr/apple-maps/). Rive ne reçoit rien de ces échanges.
3. **Liens externes** : les boutons « Marcher vers cet arrêt » (ouvre Apple Plans avec les coordonnées de l'arrêt, pas les vôtres), « Signaler un problème », « Code source », « Rive sur le web » et les liens vers les sociétés de transport ouvrent une autre application ou Safari. Ces services appliquent leurs propres politiques.

Aucune autre connexion n'est établie. Rive n'intègre aucun SDK tiers.

### Sources des horaires

Les horaires proviennent des publications GTFS officielles des sociétés de transport (RTC, STLévis, STM, STL Laval, RTL Longueuil, STS, STTR). Elles conservent leurs droits sur ces données et n'endossent pas Rive. Les attributions et licences sont affichées dans l'onglet À propos.

### Vos choix et vos droits

- **Effacer** vos favoris et la ville choisie : À propos > « Effacer mes favoris et ma préférence de ville ».
- **Supprimer l'application** efface toutes ses données locales, y compris le cache des horaires.
- **Localisation** : révocable à tout moment dans les Réglages iOS.
- Comme nous ne recevons aucune donnée personnelle, il n'y a rien à demander, corriger ou faire supprimer de notre côté.

### Enfants

Rive ne collecte aucune donnée et ne contient aucun contenu réservé aux adultes. Elle convient à tous les âges.

### Modifications

Toute modification de cette politique sera publiée à cette adresse avec une nouvelle date de mise à jour et reflétée dans l'écran Confidentialité de l'application.

### Contact

Questions ou signalements : <https://github.com/LeBonhommePharma/Transit/issues>.
TODO : ajouter une adresse courriel de contact si une adresse publique est souhaitée (`lp@thebonhomme.com` ou une adresse dédiée).

---

## English

### Scope

This policy covers the native **Rive** app for iPhone and iPad (bundle identifier `com.thebonhomme.rive`). The Rive/Transit website at `thebonhomme.com/transit/` may use other services and is not covered by this text.

### In short

- No account, no sign-up.
- No advertising, no usage analytics, no tracking, no advertising identifier.
- Stop search, departure calculation and journey proposals run entirely on your device.
- Location is optional, requested only when you tap **Autour de moi** (Around me), used on the device, and never stored or transmitted by Rive.
- We receive no personal data from the app.

### Data kept on your device

Rive stores locally, in the app's preferences (UserDefaults):

- your **favourite stops** (stop identifier and city);
- the **selected city**.

Rive also keeps, in the app's cache folder, the last copy of the public timetables downloaded for a city (`atlas.json` and `timetable.json`) so they remain available offline.

This data does not leave the device. It is part of the device's iCloud or iTunes/Finder backup according to your iOS settings, like any app's data.

### Location (optional)

- Rive asks for location permission **only when you tap "Autour de moi"** in the Explore tab ("While Using the App" only; Rive never asks for background access).
- The requested accuracy is about 100 metres.
- The position is used only to centre the map and list nearby stops. It is not saved, is not kept beyond the session, and is never sent to Rive's data server or to anyone else by Rive.
- You can decline or revoke the permission in Settings > Privacy & Security > Location Services. The app remains fully usable through stop search.

### Network connections

The app works offline with the bundled timetables. It connects to the network in only three cases:

1. **Refresh timetables** (button in Explore and in About): Rive downloads the selected city's `atlas.json` and `timetable.json` from `https://thebonhomme.com/transit/data/`, a static site hosted by GitHub Pages. The request carries no search, favourite or GPS position; only the technical information of any web request (IP address, requested resource, the app's system `User-Agent`). We do not use these access logs. GitHub describes its practices in its [General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
2. **Map**: the map in the Explore tab and in journey details is provided by Apple MapKit. Map tiles and requests are handled by Apple under the [Apple Maps privacy policy](https://www.apple.com/legal/privacy/data/en/apple-maps/). Rive receives nothing from these exchanges.
3. **External links**: "Marcher vers cet arrêt" (opens Apple Maps with the stop's coordinates, not yours), "Signaler un problème", "Code source", "Rive sur le web" and the transit agency links open another app or Safari. Those services apply their own policies.

No other connection is made. Rive embeds no third-party SDK.

### Timetable sources

Timetables come from the transit agencies' official GTFS publications (RTC, STLévis, STM, STL Laval, RTL Longueuil, STS, STTR). They retain their rights over that data and do not endorse Rive. Attributions and licences are shown in the About tab.

### Your choices and rights

- **Erase** your favourites and selected city: About > "Effacer mes favoris et ma préférence de ville".
- **Deleting the app** erases all its local data, including the timetable cache.
- **Location**: revocable at any time in iOS Settings.
- Since we receive no personal data, there is nothing to access, correct or delete on our side.

### Children

Rive collects no data and contains no adult content. It is suitable for all ages.

### Changes

Changes to this policy will be published at this address with a new update date and reflected in the app's Privacy screen.

### Contact

Questions or reports: <https://github.com/LeBonhommePharma/Transit/issues>.
TODO: add a contact email address if a public one is wanted (`lp@thebonhomme.com` or a dedicated address).
