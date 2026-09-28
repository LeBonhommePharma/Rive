# Native iOS verification

Verified September 22, 2026 (America/Toronto), on branch `astra/rive-public-ui-wip`, based on commit `ebd6f9a5cade97148ae5c7202f2ea173e27a7521` plus the uncommitted native implementation. No commit, push, upload or App Store submission was performed.

The missing native application project is resolved: `ios/Rive.xcodeproj` builds the SwiftUI/MapKit **Rive** application, creates a signed device archive and exports a local App Store distribution IPA. The app uses bundle identifier `com.thebonhomme.rive`, team `ZJLX84G8QV`, version `1.0.0` (build `1`), and targets iOS 17 or later on iPhone and iPad.

## Results

| Check | Result |
| --- | --- |
| iPhone simulator build and launch | Passed; iPhone 18 Pro, iOS 27.2 |
| Native unit tests | 12 passed, 0 failed, 0 skipped |
| Native UI smoke test | 1 passed, 0 failed, 0 skipped; search, stop departures, favourites and privacy without location permission |
| iPad simulator build and launch | Passed; iPad Pro 11-inch (M5), iOS 27.2; Explorer screenshot visually inspected |
| Web regression tests (`npm test`) | 258 passed, 0 failed, 0 skipped |
| Release device archive | Passed; `build/ios/Rive.xcarchive` |
| App Store distribution export | Passed; `build/ios/AppStore/Rive.ipa` |
| Exported app signature | `codesign --verify --deep --strict` passed |
| Distribution profile | Correct team/app identifier; `get-task-allow=false`, `beta-reports-active=true`, no provisioned-device list |
| Bundled resources | Privacy manifest and all four city datasets present in the exported app |
| Shell/plist/diff checks | Passed |

[Distribution receipt](distribution-verification.json) records the final IPA SHA-256, size, SDK, profile characteristics and signature result. It contains no certificate or private key material. Build outputs are ignored by Git.

The unit tests cover all four real bundled datasets, service calendars and exceptions, tomorrow's service, departures beyond midnight, agency time zones, the GTFS daylight-saving anchor, accent-insensitive search, duplicate departures, transfer timing, invalid references, rejected city paths, corrupt-cache fallback and preservation of cached data after failed refresh.

## Visual evidence

- [iPhone stop departures](departures.png)
- [iPhone in-app privacy](privacy.png)
- [iPad Explorer](ipad-explorer.jpg)

These are verification captures, not a complete App Store screenshot set.

## Local execution evidence

- Unit tests: `/Users/lp.more/Library/Developer/XcodeBuildMCP/workspaces/Transit-8709d84df43e/result-bundles/test_sim_2026-09-23T02-14-46-426Z_pid75550_332c0b11.xcresult`
- UI smoke test: `/Users/lp.more/Library/Developer/XcodeBuildMCP/workspaces/Transit-8709d84df43e/result-bundles/test_sim_2026-09-23T02-13-15-390Z_pid75550_51c1e867.xcresult`
- Archive log: `/tmp/rive-ios-final-archive.log`
- Export log: `/tmp/rive-ios-final-export.log`
- Web test log: `/tmp/rive-native-web-tests.log`

An initial UI run exposed an ambiguous test selector for “Fermer”; the test now scopes the stop-sheet close button to its navigation bar, and the rerun passed. An initial archive export failed because Apple's rsync spawned an incompatible Homebrew rsync worker. The release helper now scopes PATH to Apple's system tools; the final export passed. Neither correction changes global machine configuration.

## Remaining release work

This machine uses **Xcode-beta.app 27.2 (27B5019j)** with the iPhoneOS 27.2 SDK. Local signing/export success does not establish App Store acceptance of that toolchain. Rebuild using an Apple-accepted release/RC before production upload.

Physical-device behavior, denied/approximate location, VoiceOver, large text, the full supported OS range and TestFlight have not been validated. Journey proposals currently support direct travel or one transfer at the same stop/station; arrival durations are explicitly estimated from representative hop times.

Complete the App Store Connect record and name availability, published privacy/support pages, App Privacy and other metadata, screenshots, feed freshness, device testing and TestFlight before submission. See [the iOS guide](../../ios/README.md) for reproducible build/export commands and release scope.
