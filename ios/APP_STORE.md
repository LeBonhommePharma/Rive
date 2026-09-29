# Rive — App Store Connect submission kit

Prepared 2026-09-28 from the code in `ios/RiveApp`, `native/RiveKit` and the project files, on a Linux machine without Xcode or Apple credentials. Nothing here was built, uploaded or submitted; every value marked **TODO** is unknown to the repository and must be confirmed by a person with access to the Apple Developer account and to thebonhomme.com.

Check the character limits before pasting: `node scripts/appstore-metadata.mjs`. Every fenced block below that carries `max=` is measured in Unicode code points, the unit App Store Connect uses.

## 1. App record

| Field | Value | Source |
| --- | --- | --- |
| Platform | iOS (iPhone and iPad; `TARGETED_DEVICE_FAMILY = 1,2`) | `ios/project.yml:33` |
| Bundle ID | `com.thebonhomme.rive` (explicit) | `ios/project.yml:31`, `ios/Rive.xcodeproj/project.pbxproj:431` |
| Team | `ZJLX84G8QV` | `ios/project.yml:14`, `ios/ExportOptions.plist:6` |
| Name | `Rive` — **TODO: check availability in App Store Connect** (see §2) | `ios/RiveApp/Info.plist:5` |
| Primary language | French (Canada) — `fr-CA` | `CFBundleDevelopmentRegion = fr` |
| SKU | suggested `rive-ios` (any unique string; never shown to users) | — |
| Version / build | `1.0.0` / `1` | `ios/project.yml:16-17` |
| Minimum OS | iOS 17.0 | `ios/project.yml:5`, `native/RiveKit/Package.swift:7` |
| Primary category | Navigation | — |
| Secondary category | Travel | — |
| Price | Free (tier 0), no in-app purchases, no subscriptions | — |
| Availability | Suggested: all territories (the data is Québec-specific but harmless elsewhere). Minimum: Canada. | — |
| Mac availability ("Make available on Mac", Apple silicon) | Suggested **off** for 1.0: untested; `SUPPORTS_MACCATALYST = NO` does not prevent "Designed for iPad" availability. | `ios/project.yml:37` |
| visionOS "Designed for iPad" availability | Suggested **off** for 1.0: untested. | — |
| Copyright | `© 2026 Rive contributors` — **TODO: confirm the legal entity to name (NOTICE says "Rive contributors"; the team is registered to a person or company Apple already knows)** | `NOTICE:2` |
| Licence agreement | Apple standard EULA (the app is Apache-2.0 but the EULA governs the store download) | `LICENSE` |
| Content rights ("Does your app contain, show, or access third-party content?") | **Yes**, and you have the rights: the timetables are the agencies' open-data GTFS publications, attributed in the About tab with licence links. | `ios/RiveApp/AboutView.swift:38-47`, `public/data/*/atlas.json` `meta.agencies` |

## 2. App name

The bundle display name is `Rive`. App Store names must be unique, and "Rive" is also the name of an unrelated animation-tooling company (rive.app) that may already hold the name or a trademark on the store. **TODO: try `Rive` in App Store Connect first; if it is refused or if a trademark objection under Guideline 5.2.1 is a concern, use one of the alternatives below.** The display name on the device (`CFBundleDisplayName`) can stay `Rive` either way.

```text field=fr.name max=30
Rive
```

```text field=fr.name.alternative max=30
Rive – Transport collectif
```

```text field=en.name max=30
Rive
```

```text field=en.name.alternative max=30
Rive – Québec Transit
```

## 3. Localized metadata — French (Canada), primary

```text field=fr.subtitle max=30
Horaires de bus et de métro
```

```text field=fr.promotional_text max=170
Prochains départs, favoris et trajets pour Québec, Lévis, Montréal, Laval, Longueuil, Sherbrooke et Trois-Rivières. Horaires officiels inclus, disponibles hors connexion.
```

```text field=fr.description max=4000
Rive affiche les horaires de transport collectif de Québec, Lévis, Montréal, Laval, Longueuil, Sherbrooke et Trois-Rivières, à partir des publications GTFS officielles des sociétés de transport. Gratuite, sans compte, sans publicité, et à code source ouvert.

LES PROCHAINS DÉPARTS, À N'IMPORTE QUEL ARRÊT
Cherchez un arrêt par son nom ou son numéro et voyez les prochains départs sur 24 heures, avec la ligne, la destination et le temps d'attente. Consultez l'arrêt où vous irez plus tard, pas seulement celui où vous êtes.

UNE CARTE POUR EXPLORER
Déplacez la carte pour lister les arrêts de la zone. Touchez « Autour de moi » pour centrer la carte sur votre position ; c'est facultatif, la recherche fonctionne sans localisation.

VOS FAVORIS
Gardez vos arrêts habituels à portée de main. Ils restent sur votre appareil.

UN TRAJET D'ARRÊT À ARRÊT
Choisissez un départ, une destination et une heure. Rive propose des trajets directs ou avec une correspondance au même arrêt ou à la même station, selon les horaires publiés, avec des durées estimées. Un bouton ouvre Apple Plans pour marcher jusqu'à l'arrêt.

HORS CONNEXION
Les horaires des quatre régions sont inclus dans l'application. Un bouton Actualiser télécharge la dernière publication quand vous le souhaitez. Seule la carte a besoin d'une connexion.

RÉGIONS ET SOCIÉTÉS DE TRANSPORT
• Québec et Lévis : RTC, STLévis
• Montréal, Laval et Longueuil : STM, STL, RTL
• Sherbrooke : STS
• Trois-Rivières : STTR

CONFIDENTIALITÉ
Tout se calcule sur votre appareil. Aucun compte, aucun outil d'analyse, aucune publicité. La position n'est demandée que lorsque vous touchez « Autour de moi », n'est jamais enregistrée et n'est jamais transmise par Rive.

BON À SAVOIR
Rive présente les horaires planifiés. Elle n'annonce pas la position des véhicules ni les retards en temps réel ; vérifiez les avis du transporteur. Les sociétés de transport conservent les droits sur leurs données et n'endossent pas Rive.

Code source et licence Apache 2.0 : github.com/LeBonhommePharma/Transit
```

```text field=fr.keywords max=100
transport,autobus,trajet,départs,STM,RTC,STL,RTL,STTR,Québec,Montréal,Laval,Longueuil,Sherbrooke
```

Keyword notes: words already in the name or subtitle (« horaires », « bus », « métro ») are indexed from there and are not repeated. « Trois-Rivières », « Lévis » and « STS » did not fit in 100 characters; swap them in if analytics later show demand.

```text field=fr.whats_new max=4000
Première version de Rive pour iPhone et iPad : recherche d'arrêts, prochains départs, favoris, trajets d'arrêt à arrêt et horaires hors connexion pour Québec, Lévis, Montréal, Laval, Longueuil, Sherbrooke et Trois-Rivières.
```

## 4. Localized metadata — English (Canada)

The app's interface is French only (all strings in `ios/RiveApp/*.swift` are hard-coded French; `knownRegions` = Base, fr). The English listing must say so, which the description does.

```text field=en.subtitle max=30
Bus and metro timetables
```

```text field=en.promotional_text max=170
Next departures, favourites and stop-to-stop trips for Québec, Lévis, Montréal, Laval, Longueuil, Sherbrooke and Trois-Rivières. Official timetables included, offline.
```

```text field=en.description max=4000
Rive shows public-transit timetables for Québec, Lévis, Montréal, Laval, Longueuil, Sherbrooke and Trois-Rivières, built from the transit agencies' official GTFS publications. Free, no account, no ads, open source. The app's interface is in French.

NEXT DEPARTURES AT ANY STOP
Search a stop by name or number and see the next 24 hours of departures with the route, the destination and the wait. Look up the stop you will use later, not only the one you are standing at.

A MAP TO EXPLORE
Move the map to list the stops in view. Tap "Autour de moi" (Around me) to centre the map on your position; it is optional, and search works without location.

FAVOURITES
Keep your usual stops one tap away. They stay on your device.

STOP-TO-STOP TRIPS
Pick a departure stop, a destination and a time. Rive proposes direct trips or trips with one transfer at the same stop or station, from the published timetables, with estimated durations. A button opens Apple Maps for the walk to the stop.

OFFLINE
Timetables for all four regions ship inside the app. A refresh button downloads the latest publication whenever you want. Only the map needs a connection.

REGIONS AND AGENCIES
• Québec and Lévis: RTC, STLévis
• Montréal, Laval and Longueuil: STM, STL, RTL
• Sherbrooke: STS
• Trois-Rivières: STTR

PRIVACY
Everything is computed on your device. No account, no analytics, no advertising. Location is requested only when you tap "Autour de moi", is never stored and is never transmitted by Rive.

GOOD TO KNOW
Rive shows planned timetables. It does not report vehicle positions or real-time delays; check the agency's service notices. The transit agencies retain their rights over their data and do not endorse Rive.

Source code, Apache 2.0: github.com/LeBonhommePharma/Transit
```

```text field=en.keywords max=100
transit,schedule,departures,offline,STM,RTC,STL,RTL,STTR,Quebec,Montreal,Laval,Longueuil,Sherbrooke
```

```text field=en.whats_new max=4000
First release of Rive for iPhone and iPad: stop search, next departures, favourites, stop-to-stop trips and offline timetables for Québec, Lévis, Montréal, Laval, Longueuil, Sherbrooke and Trois-Rivières. French-language interface.
```

## 5. URLs

All three must return a real page before submission; App Review opens them. The web deployment publishes only `thebonhomme.com/transit/` (see `DEPLOY.md` and `scripts/publish-transit.mjs`), so paths under `/transit/` are the ones that can exist. **TODO: confirm each URL responds 200 in a browser; none could be reached from the preparation machine.**

| Field | Suggested URL | Status |
| --- | --- | --- |
| Support URL (required) | `https://github.com/LeBonhommePharma/Transit/issues` | Exists (public repository issues). Alternative if a site page is preferred: `https://thebonhomme.com/transit/support/` — TODO create. |
| Marketing URL (optional) | `https://thebonhomme.com/transit/` | TODO confirm 200. |
| Privacy Policy URL (required) | `https://thebonhomme.com/transit/privacy/` — publish `ios/PRIVACY.md` there | TODO create the page in the apex Pages repository (`LeBonhommePharma/lebonhommepharma.github.io`), which serves `/transit/`. Fallback accepted by Apple: a rendered page such as `https://github.com/LeBonhommePharma/Transit/blob/main/ios/PRIVACY.md`. |

The privacy policy URL is also required inside the App Privacy section and must match the in-app Privacy screen (`ios/RiveApp/AboutView.swift:66-92`).

## 6. Age rating

Answer **None / No** to every item of the questionnaire; the expected result is **4+**. Justification from the code: no user-generated content, no messaging, no web view (external links open Safari or Maps), no advertising, no purchases, no gambling, no medical content, no mature themes, no contests, no parental-control or age-assurance features, not a Kids Category app.

| Question (as of the 2025 questionnaire) | Answer |
| --- | --- |
| Cartoon or fantasy violence, realistic violence, graphic violence | None |
| Profanity or crude humour | None |
| Mature or suggestive themes, sexual content, nudity | None |
| Horror or fear themes | None |
| Medical or treatment information | None |
| Alcohol, tobacco or drug use or references | None |
| Simulated gambling, real gambling, loot boxes | None / No |
| Contests | None |
| Unrestricted web access | No (no in-app browser) |
| User-generated content, messaging, social features | No |
| Advertising | No |
| Parental controls, age assurance | No |
| Made for Kids | No |

## 7. App Privacy ("nutrition label")

Answer: **Data Not Collected**. Derivation from the code:

| Data type | Collected? | Why |
| --- | --- | --- |
| Location (precise / coarse) | No | `TransitLocation.swift` requests when-in-use authorization at 100 m accuracy, keeps the coordinate in memory, uses it to centre the map and list nearby stops. It is never written to disk and never placed in a network request (`TransitRepository.fetch` sends only the city and file name). Apple's definition of "collected" is data transmitted off the device in a way accessible to the developer; this is not. |
| Identifiers, contact info, user content, search history | No | No account, no `identifierForVendor`, no advertising identifier, no search logging. Favourites and the selected city stay in `UserDefaults` (`TransitStore.swift:7-11,79`). |
| Usage data, diagnostics, product interaction | No | No analytics or crash SDK; the only third-party code is none (the app links only the first-party `RiveKit` package). Crash logs that users opt to share with Apple and that Xcode Organizer shows are Apple's collection, not the developer's. |
| Other data (IP address in server logs) | No | The Refresh button fetches static JSON from GitHub Pages (`https://thebonhomme.com/transit/data/`). GitHub Pages exposes no access logs to the site owner, so nothing is accessible to the developer. |
| Data used for tracking | No | `NSPrivacyTracking = false`, no tracking domains (`ios/RiveApp/PrivacyInfo.xcprivacy:4-5`). |

Privacy manifest (`ios/RiveApp/PrivacyInfo.xcprivacy`): declares `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1` (the app reads and writes its own defaults). No other required-reason API is used: no file-timestamp reads (`Data(contentsOf:)` and atomic writes only), no `systemUptime`/`mach_absolute_time`, no disk-space queries, no active-keyboard queries. MapKit, CoreLocation and SwiftUI are Apple frameworks and need no manifest entry.

## 8. Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in `ios/RiveApp/Info.plist:15`, so App Store Connect skips the encryption questions for each build. The declaration is correct: the app's only cryptography is HTTPS through `URLSession` and MapKit, which Apple's exemption covers, and it contains no proprietary or third-party encryption. If the key were ever removed, answer: uses encryption → Yes; qualifies for exemption → Yes (only standard encryption in the OS); no French export documentation needed.

## 9. App Review information

| Field | Value |
| --- | --- |
| Sign-in required | **No**. Leave the demo account fields empty. |
| Contact first/last name, phone, email | **TODO** (the person Apple may call during review; the email in the developer account is `lp@thebonhomme.com`). |
| Attachment | Optional: none needed. |

Review notes, both languages in one field:

```text field=review_notes max=4000
FR — Rive est une application native SwiftUI/MapKit. Aucun compte ni connexion n'est nécessaire.

Fonctionnement hors connexion : les horaires GTFS officiels des quatre régions (Québec/Lévis, Montréal/Laval/Longueuil, Sherbrooke, Trois-Rivières) sont inclus dans l'application. Tout fonctionne en mode avion sauf la carte Apple Plans. Le bouton « Actualiser » (flèche circulaire dans Explorer, ou dans À propos) télécharge la dernière publication depuis https://thebonhomme.com/transit/data/ ; en cas d'échec, les horaires inclus restent utilisables et un message le dit.

Parcours suggéré :
1. Onglet Explorer (ville « Québec » par défaut) : taper « Youville » dans la recherche, ouvrir « D'Youville » (arrêt 1190) pour voir les prochains départs ; toucher « Ajouter aux favoris ».
2. Onglet Favoris : l'arrêt apparaît ; glisser pour retirer.
3. Onglet Trajet : « De » = D'Youville, « Vers » = un autre arrêt (par exemple chercher « Université Laval »), puis ouvrir une proposition pour la carte et les correspondances. Les durées sont des estimations et sont annoncées comme telles.
4. Changer de ville avec le sélecteur (Montréal, puis chercher « Berri-UQAM »).
5. Onglet À propos > Confidentialité : politique intégrée ; « Effacer mes favoris et ma préférence de ville » supprime les données locales.

Localisation : demandée seulement en touchant « Autour de moi » dans Explorer (« Lorsque l'app est active », ~100 m). Si elle est refusée, un message propose la recherche et toute l'application reste utilisable ; recherche et trajets n'ont jamais besoin de la position. Avec une position simulée, la carte se centre dessus ; des arrêts proches n'apparaissent que près d'une ville couverte.

Interface en français seulement. Horaires planifiés : Rive n'annonce ni position de véhicule ni retard en temps réel, et le dit à l'écran. Données : GTFS ouverts des sociétés de transport, attribués dans À propos avec liens de licence. Code source Apache 2.0 : https://github.com/LeBonhommePharma/Transit

EN — Rive is a native SwiftUI/MapKit app. No account or sign-in is needed.

Offline operation: the official GTFS timetables of all four regions (Québec/Lévis, Montréal/Laval/Longueuil, Sherbrooke, Trois-Rivières) ship inside the app. Everything works in airplane mode except the Apple Maps map. The refresh button (circular arrow in Explore, or in About) downloads the latest publication from https://thebonhomme.com/transit/data/; if it fails, the bundled timetables remain in use and a message says so.

Suggested path:
1. Explore tab (city "Québec" by default): type "Youville" in the search field, open "D'Youville" (stop 1190) to see next departures; tap "Ajouter aux favoris".
2. Favoris tab: the stop is listed; swipe to remove.
3. Trajet tab: "De" = D'Youville, "Vers" = another stop (for example search "Université Laval"), then open a proposal for the map and the transfer. Durations are estimates and are labelled as such.
4. Switch city with the picker (Montréal, then search "Berri-UQAM").
5. À propos tab > Confidentialité: built-in privacy policy; "Effacer mes favoris et ma préférence de ville" deletes the local data.

Location: requested only when tapping "Autour de moi" in Explore ("While Using", ~100 m). If denied, a message suggests searching and the whole app stays usable; search and trips never need location. With a simulated location the map centres on it; nearby stops appear only near a covered city.

French-language interface only. Planned timetables: Rive reports no vehicle positions or real-time delays and says so on screen. Data: the agencies' open GTFS publications, attributed in About with licence links. Source code, Apache 2.0: https://github.com/LeBonhommePharma/Transit
```

## 10. Screenshots

Required sets (App Store Connect, 2026): **iPhone 6.9-inch** and, because the app supports iPad, **iPad 13-inch**. Smaller sizes are derived automatically from these unless you upload them. Up to 10 per set; PNG or JPEG; no alpha; status bar is fine. Take them in French with the Québec city selected unless noted.

| Set | Accepted pixel sizes | Simulator to use |
| --- | --- | --- |
| iPhone 6.9" | 1320 × 2868 portrait (or 2868 × 1320); 1290 × 2796 also accepted | The largest "Pro Max" iPhone in the installed release SDK (the iPhone 17 Pro Max class, or newer). |
| iPad 13" | 2064 × 2752 portrait (or 2752 × 2064); 2048 × 2732 also accepted | iPad Pro 13-inch (M4 class or newer). |

Capture: boot the simulator, `xcrun simctl io booted screenshot ~/Desktop/rive-<n>.png` (or Cmd-S in Simulator). Check the size with `sips -g pixelWidth -g pixelHeight <file>`.

The existing captures in `qa/native-ios/` are references for framing only: `departures.png` and `privacy.png` are 1206 × 2622 (a 6.3-inch device, not accepted for the 6.9-inch set) and `ipad-explorer.jpg` is a 551 × 800 preview. All must be recaptured at the sizes above.

Shot list (portrait, in order):

| # | Screen | How to reach it | Reference |
| --- | --- | --- | --- |
| 1 | Explorer — map and nearby stops, Québec | Explore tab, no search, map zoomed on downtown | `qa/native-ios/ipad-explorer.jpg` (framing) |
| 2 | Départs — next departures at a stop | Search « Youville » → « D'Youville » (1190) | `qa/native-ios/departures.png` |
| 3 | Recherche — results list | Explore tab, search field with « Youville » typed | — |
| 4 | Trajet — proposals | Trajet tab, De = D'Youville, Vers = a stop at Université Laval, « Partir maintenant » | — |
| 5 | Détail du trajet — map with route line and legs | Open a proposal from shot 4 | — |
| 6 | Favoris — a few saved stops | Add 3–4 favourites first | — |
| 7 | Montréal — departures at « STATION BERRI-UQAM » | City picker → Montréal, search « Berri » | — |
| 8 | Confidentialité — in-app policy | À propos → Confidentialité | `qa/native-ios/privacy.png` |

iPad set: shots 1, 2, 4, 5 and 8 are enough; landscape 2752 × 2064 shows the map and list together well. Take the shots at a time of day with service running (departures list not empty) and within the bundled feed periods (see §12, "feed freshness").

Optional app preview video: not needed for 1.0.

## 11. Submission checklist (Mac with Xcode)

1. **Check out this branch** on the Mac: `git fetch && git checkout appstore-prep` (or merge it into the release branch). `project.yml` did not change in this commit, so `xcodegen generate --spec ios/project.yml` is not required; run it only if you edit `project.yml`, then commit the regenerated `ios/Rive.xcodeproj/project.pbxproj`.
2. **Use a release Xcode.** The last verification used Xcode-beta 27.2 (`qa/native-ios/README.md`); App Store Connect accepts only builds from released Xcode/SDK versions. `xcodebuild -version` must show a non-beta version.
3. **Feed freshness.** Run `npm run ingest:force` (or wait for the `update-gtfs.yml` workflow) so `public/data/` carries the latest GTFS, then commit. The bundled Montréal feed ends 2026-11-01 (`public/data/montreal/atlas.json` `meta.end`); Québec, Sherbrooke and Trois-Rivières end 2026-12-20/26. A build reviewed after a feed's end date shows the orange "période publiée terminée" banner until the user refreshes.
4. **Confirm the live data URL** the app refreshes from: `curl -sI https://thebonhomme.com/transit/data/quebec/atlas.json | head -1` must print `HTTP/2 200`. This commit changed the base URL from `/rive/data/` to `/transit/data/` because only `/transit/` is published (`DEPLOY.md`); if `/rive/` turns out to exist and be preferred, revert `native/RiveKit/Sources/RiveKit/TransitRepository.swift:23`, `ios/RiveApp/AboutView.swift:26` and `ios/README.md`.
5. **Publish the URLs** of §5 (privacy policy from `ios/PRIVACY.md`, support, marketing) and confirm they load.
6. **Tests on the simulator:**
   `xcodebuild -project ios/Rive.xcodeproj -scheme Rive -destination 'platform=iOS Simulator,name=<installed iPhone>' test`
   (12 unit tests + 1 UI smoke test at the last verification.) Also `scripts/swift-test` for the package checks.
7. **Physical-device pass** on at least one iPhone and one iPad: first launch, search, departures, favourites, trip, city switch, Refresh online, Refresh in airplane mode (must keep the bundled data and show the message), location denied, location approximate (Settings → Rive → Precise Location off), Dynamic Type at the largest accessibility size, VoiceOver on the Explore list and stop sheet, dark mode, rotation on iPad and Split View.
8. **Screenshots** per §10.
9. **App Store Connect record:** My Apps → + → New App → iOS, name (§2), primary language French (Canada), bundle ID `com.thebonhomme.rive` (register it in Certificates, Identifiers & Profiles first if Xcode's automatic signing has not already), SKU. Then fill App Information (categories, content rights, age rating §6), Pricing and Availability (Free, territories, Mac/visionOS availability §1), App Privacy (§7, privacy policy URL), and the version page (metadata §3–§4, URLs §5, screenshots §10, review information §9).
10. **Build number.** App Store Connect refuses a build number it already has for the version. First upload: build `1`. Later uploads: `RIVE_BUILD_NUMBER=<n> scripts/ios-release archive` (or bump `CURRENT_PROJECT_VERSION` in `project.yml` and regenerate).
11. **Archive and export:**
    `scripts/ios-release archive` → `build/ios/Rive.xcarchive`
    `scripts/ios-release export` → `build/ios/AppStore/Rive.ipa` (uses `ios/ExportOptions.plist`: method `app-store-connect`, automatic signing, symbols uploaded).
    Or in Xcode: Product → Archive, then Organizer → Distribute App → App Store Connect.
12. **Validate and upload:** either Organizer → Distribute App → Upload, or Transporter with the IPA, or with an App Store Connect API key (Users and Access → Integrations → App Store Connect API, role App Manager or Developer; put `AuthKey_<KEY_ID>.p8` in `~/.appstoreconnect/private_keys/`):
    `RIVE_ASC_KEY_ID=<id> RIVE_ASC_ISSUER_ID=<issuer> scripts/ios-release validate`
    `RIVE_ASC_KEY_ID=<id> RIVE_ASC_ISSUER_ID=<issuer> scripts/ios-release upload`
    Record the IPA SHA-256 in `qa/native-ios/distribution-verification.json` as the previous verification did.
13. **Processing and TestFlight.** Wait for the "build processed" email (export compliance is answered automatically by the Info.plist key). In TestFlight, add the build to an internal group, install on the test devices, and repeat the critical path of step 7 on that exact build. Optionally add external testers (requires a short Beta App Review).
14. **Submit.** On the version page, select the processed build, confirm the review notes and contact, choose release timing (manual release is safest for 1.0), Add for Review → Submit to App Review. Answer "No" to the advertising identifier question if asked.
15. **After approval:** release (if manual), tag the commit (`git tag ios-1.0.0-build1`), and update `qa/native-ios/README.md` with the review outcome and the build's receipt.

## 12. Pre-submission audit (static, 2026-09-28)

Read from the files listed; nothing was compiled.

### Fixed in this commit

| Item | Finding | Change |
| --- | --- | --- |
| Refresh URL | `TransitRepository` fetched `https://thebonhomme.com/rive/data/`, but the deployment only publishes `/transit/` (`DEPLOY.md`, `scripts/publish-transit.mjs`, `README.md`, `scripts/install-me`, `RiveCLI`). Refresh would fail for every user and App Review could flag the button (Guideline 2.1). | `native/RiveKit/Sources/RiveKit/TransitRepository.swift:23`, `ios/RiveApp/AboutView.swift:26` ("Rive sur le web"), `ios/README.md`. Needs step 4 confirmation. |
| Build-number reuse | `manageAppVersionAndBuildNumber = false` and `CURRENT_PROJECT_VERSION = 1` with no override path; a second upload would be rejected. | `scripts/ios-release` accepts `RIVE_BUILD_NUMBER` / `RIVE_MARKETING_VERSION`, and gained `validate` / `upload` actions. |
| Missing metadata and policy | No App Store metadata, review notes or publishable privacy policy existed. | This file, `ios/PRIVACY.md`, `scripts/appstore-metadata.mjs`. |

### Verified correct, no change needed

| Check | Evidence |
| --- | --- |
| Versioning | `CFBundleShortVersionString = $(MARKETING_VERSION)` (1.0.0), `CFBundleVersion = $(CURRENT_PROJECT_VERSION)` (1) — `Info.plist:11-12`, `project.yml:16-17`, pbxproj lines 371, 391, 527, 540. |
| Location purpose string | `NSLocationWhenInUseUsageDescription` present, specific, and matches the only request in the code (`requestWhenInUseAuthorization`, `TransitLocation.swift:23`). No Always, no background modes, no temporary full-accuracy request, so no other location keys are needed. |
| Other permissions | No camera, microphone, photos, contacts, calendar, Bluetooth, motion, HealthKit, notifications or Siri usage in `ios/RiveApp` or the linked `RiveKit` sources; no usage strings missing. |
| Encryption | `ITSAppUsesNonExemptEncryption = false` (`Info.plist:15`); only HTTPS. |
| Orientations / iPad multitasking | iPhone: portrait + both landscapes; iPad: all four, `UIRequiresFullScreen` absent → Split View and Slide Over supported, as iPadOS requires (`Info.plist:18-19`). |
| Launch screen | `UILaunchScreen` dictionary present (`Info.plist:16`). |
| App icon | `AppIcon.png` 1024 × 1024, 8-bit RGB, no alpha channel, no transparency chunk (checked with Python); `Contents.json` declares the single universal 1024 asset, `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`. |
| Privacy manifest | UserDefaults `CA92.1` is the only required-reason API used; tracking false; collected data types empty and consistent with §7 (`PrivacyInfo.xcprivacy`, bundled by `pbxproj:279`). |
| Deployment target | iOS 17.0 in `project.yml`, both pbxproj configurations and `Package.swift`; Swift 6 language mode; package tools 6.2 (Xcode 26+). |
| Export options | `method = app-store-connect`, `destination = export`, team `ZJLX84G8QV`, automatic signing, symbols uploaded (`ExportOptions.plist`). |
| Bundle identifiers | App `com.thebonhomme.rive`, tests `com.thebonhomme.rive.tests`, UI tests `com.thebonhomme.rive.uitests`, identical in `project.yml` and pbxproj (lines 413, 431, 449, 467, 485, 562); test bundles use `TEST_HOST` / `TEST_TARGET_NAME = Rive`. |
| Watch / Live Activities | No watch target and no widget extension exist in the project; `ios/RiveWatch/`, `native/RiveWatch/` and `ios/Rive/LiveDeparturePusher.swift` are unlinked prototypes (not in any `PBXSourcesBuildPhase`). No `NSSupportsLiveActivities`, `WKCompanionAppBundleIdentifier` or watch entitlement is needed. `RiveKit` still compiles `TransitAttributes.swift` (ActivityKit) and `PhoneToWatch.swift` (WatchConnectivity) into the app; harmless but dead weight (see below). |
| Guideline 4.2 (minimum functionality) | Genuine native app: SwiftUI `TabView`, MapKit `Map` with annotations and polylines, on-device search, schedule and journey computation in `RiveKit`, 34 MB of bundled data, no web view. |
| Guideline 5.1.1 (privacy) | Location optional and explained before the prompt (button label, in-app policy); no account; personal-data erase button; in-app privacy screen. |
| Guideline 5.2.2 / 5.2.3 (third-party data) | Agency attribution text and licence links rendered from each atlas `meta.attribution` / `meta.agencies` (`AboutView.swift:38-47`); non-endorsement statement; `NOTICE` lists the sources. |
| Guideline 2.5.1 (public APIs) | `FoundationModels` use is `#if canImport` + `@available(iOS 26)` (public API), and is not called by the app. |
| `.gitignore` | `/build` covers `build/ios` archives and IPAs. |

### Needs a person (cannot be resolved from the repository)

| Item | Where | What to do |
| --- | --- | --- |
| App name availability / trademark | §2 | Try `Rive` in App Store Connect; fall back to an alternative. |
| Support, marketing and privacy URLs | §5 | Create/confirm the pages; none reachable from the preparation machine. |
| Live refresh URL | step 4 | Confirm `https://thebonhomme.com/transit/data/<city>/atlas.json` returns 200. |
| Review contact and copyright holder | §1, §9 | Fill in App Store Connect. |
| Release Xcode | step 2 | Last archive used a beta toolchain. |
| Screenshots at accepted sizes | §10 | Existing captures are the wrong size. |
| Feed freshness at submission time | step 3 | Montréal feed ends 2026-11-01. |
| Device testing, TestFlight | steps 7, 13 | Only simulator runs are on record. |

### Optional improvements (not blockers)

- **English localisation of the location prompt.** `NSLocationWhenInUseUsageDescription` is French only; an English device shows the French text. Add `ios/RiveApp/en.lproj/InfoPlist.strings` (and `fr.lproj`), regenerate with XcodeGen, and add `en` to `knownRegions`. The whole UI is French, so this is consistent today.
- **Trim dead framework linkage.** Exclude `TransitAttributes.swift`, `PhoneToWatch.swift`, `LiveDeparture.swift`, `BuildingShade.swift` (Metal) and `FoundationAssist.swift` from the `RiveKit` library target, or move them to a separate target, so the app binary does not link ActivityKit, WatchConnectivity, Metal and FoundationModels it never calls.
- **Bundle size.** The `../public/data` folder is copied whole, including `pois.json`, `meta.json` and `realtime.json` (unused by the app, a few KB) and the 22 MB Montréal timetable. Acceptable; App Thinning does not reduce JSON.
- **`CODE_SIGN_IDENTITY = "iPhone Developer"`** in both app configurations (`pbxproj:424,460`) is XcodeGen's legacy default; automatic signing overrides it at export, as the previous signed export showed. Removing it from the generated project would need an `xcodegen` run.
