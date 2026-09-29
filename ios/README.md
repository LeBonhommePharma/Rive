# Rive for iOS

Native SwiftUI and MapKit application for iPhone and iPad, with an iOS 17 deployment target. Open `Rive.xcodeproj` and select the **Rive** scheme. Xcode 26 or later is required by the package's Swift 6.2 tools version.

The application target replaces the former WKWebView shell. Stop search, service-calendar lookup and stop-to-stop journey proposals run in Swift on the device. The existing four city datasets are bundled directly from `../public/data` so first launch does not require a network download. Apple Maps tiles still require connectivity. Favourites and the selected city are stored on the device. Location is requested only after tapping **Autour de moi**.

The initial release includes scheduled departures and direct/one-transfer journey proposals. Arrival durations use the atlas's representative hop times and are labelled estimates. It does not include the old Watch prototype, Live Activity bridge, web weather service, crowd probes or Apple Intelligence UI. These source prototypes are not linked into the application target.

## Project and signing

- App identifier: `com.thebonhomme.rive`
- Development team: `ZJLX84G8QV`
- Display name: `Rive`
- Version/build: `1.0.0` / `1`
- Signing: automatic; credentials remain in Xcode/keychain, never in this repository.
- Supported devices: iPhone and iPad.

`project.yml` is the editable XcodeGen specification. The generated project and shared scheme are included so opening/building does not require XcodeGen. After changing targets, build settings or source files, regenerate with:

```sh
xcodegen generate --spec ios/project.yml
```

Use the repository root as the working directory for these commands.

## Test

Choose an installed iOS simulator and run Product > Test, or:

```sh
xcodebuild -project ios/Rive.xcodeproj -scheme Rive \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath build/ios/DerivedData test
```

The native tests cover decoding every bundled city, calendar exceptions, missing tomorrow service, GTFS times beyond midnight, agency time zones, daylight-saving transitions, accent-insensitive search, duplicate departures, data validation and transfer timing. The UI smoke test exercises stop search, favourites and in-app privacy without granting location permission. `native/RiveKit/Tests/RiveKitTests` can also run through `swift test --package-path native/RiveKit` with full Xcode selected.

The web regression suite remains `npm test`. The old source-string assertions requiring WKWebView handlers were removed because those handlers are no longer part of the native application; native behavior is tested through XCTest instead.

## Archive and export

```sh
scripts/ios-release archive
scripts/ios-release export
```

The helper writes `build/ios/Rive.xcarchive` and `build/ios/AppStore/`. Export uses `ExportOptions.plist`, selects App Store Connect distribution and writes a **local IPA**. Neither command uploads or submits a build. Automatic provisioning may contact Apple to obtain profiles for the configured team.

The helper uses Apple's system command path during archive/export. This avoids a verified local conflict where Apple's `/usr/bin/rsync` launched a Homebrew `rsync` worker that rejected `--extended-attributes`, causing Xcode's export step to fail with `Copy failed`.

Override `RIVE_BUILD_DIR` to select another output directory. To archive without signing for CI or local compilation checks, set `RIVE_UNSIGNED=1` when invoking `archive`. An unsigned archive cannot be exported for App Store distribution.

App Store Connect rejects a build number it has already received. `ExportOptions.plist` leaves version management manual (`manageAppVersionAndBuildNumber` is false), so either raise `CURRENT_PROJECT_VERSION` in `project.yml` and regenerate, or set `RIVE_BUILD_NUMBER` (and optionally `RIVE_MARKETING_VERSION`) when archiving:

```sh
RIVE_BUILD_NUMBER=2 scripts/ios-release archive
scripts/ios-release export
scripts/ios-release validate   # optional: altool validation with an App Store Connect API key
scripts/ios-release upload     # optional: altool upload; Xcode Organizer or Transporter also work
```

`validate` and `upload` need `RIVE_ASC_KEY_ID` and `RIVE_ASC_ISSUER_ID` plus the matching `AuthKey_<KEY_ID>.p8` in `~/.appstoreconnect/private_keys/`, where `altool` looks for it. Keep the key out of the repository.

## Data and privacy

The refresh button fetches the selected city's `atlas.json` and `timetable.json` from `https://thebonhomme.com/transit/data/`, the published copy of `public/data/` described in [`DEPLOY.md`](../DEPLOY.md). It validates the pair and atomically saves one cached dataset. Failed refreshes preserve the previous usable data; cancelled or superseded city loads do not replace the selected city. No stop search, GPS coordinates or journey endpoints are included in these requests.

The in-app privacy screen describes local preferences, optional location, Apple MapKit, data hosting and deletion controls. `PrivacyInfo.xcprivacy` declares the app's use of UserDefaults for its own settings. MapKit and hosting practices still need to be considered when answering App Store Connect's App Privacy questionnaire; the manifest is not a substitute for those answers or a published privacy-policy URL. [`PRIVACY.md`](PRIVACY.md) is the privacy-policy text to publish, and [`APP_STORE.md`](APP_STORE.md) holds the App Store Connect metadata, privacy questionnaire answers, review notes and submission checklist. `node scripts/appstore-metadata.mjs` checks the metadata character limits.

## Before upload

1. Use an Apple-accepted release/RC of Xcode. The development machine inspected during this implementation uses **Xcode-beta.app 27.2 (27B5019j)**. Local archive/export success does not establish that Apple will accept a beta SDK for production submission.
2. Refresh/verify the bundled feeds, then test physical devices, denied/approximate location, airplane mode, large text, VoiceOver and the chosen release OS versions. Simulator results do not establish physical-device behavior.
3. Verify the Rive name in App Store Connect, create or update the matching app record, and complete metadata, public support/privacy URLs, screenshots, age rating, content rights and export-compliance answers.
4. Upload the release archive, test that exact build with TestFlight and submit it for review.

The archive resolves the missing iOS project/build-target blocker. It does not by itself attest that every App Store submission requirement is complete.

See [native verification results](../qa/native-ios/README.md) for test counts, simulator captures and the exported IPA's signature receipt.
