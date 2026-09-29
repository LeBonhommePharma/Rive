# Rive UI and location verification — 2026-09-06

This pass followed an incomplete earlier verification: automated tests and a build had passed, but actual browser interaction had not been completed. The browser pass below found additional defects. Test counts are not a claim of exhaustive coverage.

## Actual browser checks

Tested using the Codex in-app browser, on the development server at `127.0.0.1:3000` and the locally served production build at `127.0.0.1:3001`. Phone/tablet dimensions were viewport emulation, not physical-device testing.

| Scenario | Result and evidence |
| --- | --- |
| 390 × 844 phone layout | Map, controls, journey sheet and error help inspected visually. |
| 320 × 740 narrow phone | Reproduced a partially obscured “Choose on the map” button; fixed. Measured controls bottom 172px, panel top 196px, document width 320px. |
| Keyboard search | Entered Berri, used ArrowDown/Enter to select Berri-UQAM as departure. |
| Real journey request | Selected Montmorency as destination; the actual API returned itineraries. Selecting the metro result drew its orange route and departure/arrival times. This verifies the interaction, not real-world travel-time accuracy. |
| Manual departure | Entered map selection, moved the map with the keyboard, confirmed the point, and verified a distinct manual marker plus departure field. Repeated in the production build. |
| City change | Changing to Montréal cleared the prior manual departure and loaded Montréal station/route choices. |
| Phone → tablet | Reproduced a blank desktop panel after a collapsed phone sheet. Fixed; verified `hidden=false`, `display=block`, and preserved departure at 768px. |
| Marker after resize | The first attempted fix still left the marker behind the panel. Corrected ordering to wait for MapLibre's own resize event. Final measured marker left 563px versus panel right 404px at 768px. |
| Full atlas, first tap | Reproduced a tap that only enlarged the sheet and missed its moving button. Fixed pointer/focus handling. Production retest entered manual selection on the first tap from the initial sheet. |
| Full atlas, 3D | Moved the map and confirmed a manual origin in the pitched view. The visible reticle and manual marker agreed; nearby-stop results updated. |
| Full atlas, theme and copy | Checked light/dark appearance, matching FR/EN location copy, and one prominent location action according to whether the sheet is open or folded. |
| Console | No captured browser-console errors during the completed interaction checks. |

## Real location limitation — not a pass

The real in-app-browser location request timed out without returning device coordinates. During a pending request, automated clicks on Cancel and other controls did not produce the expected UI changes; a reload restored interaction. This pass cannot distinguish a native permission prompt from a browser/automation integration limitation. Therefore real-browser cancellation during that condition is inconclusive, even though cancellation and stale callbacks pass the controlled tests.

The computer-use tool refused inspection of the ChatGPT/Codex host app “for safety reasons.” No OS privacy settings were changed. Successful real-device position acquisition, host permission settings, physical iPhone/iPad behavior, and separate Safari/Chrome testing remain unverified.

## Regression coverage and build

- `npm test`: **241 passed, 0 failed**. Includes 25 location-helper, 4 actual MapView-effect, 9 actual RiveApp-interaction and 22 standalone-controller tests, alongside the existing suite.
- The new tests use controlled coordinates, browser callbacks, timers and network responses. They execute actual production helpers/component handlers, but are not real GPS or browser-rendering tests.
- `npm run build -- --webpack`: passed, including TypeScript checking.
- `npm run lint`: 0 errors; 5 existing unused-variable warnings.
- Build retains the existing MapLibre package-JSON named-export warning.
- `git diff --check`: passed.

Regression cases cover denied/unavailable/timeout responses; bounded retry; requests that never call back; abort and late callbacks; invalid coordinates; real accuracy-circle geometry; city/load races; older cached fixes after manual choice; manual confirmation under 3D projection; stale deferred search results; first-click event handling; keyboard focus preservation; panel and camera breakpoint behavior.

## Repairs made during this pass

- Stopped late GPS/city-loading work from undoing a newer city or manual choice.
- Prevented a false GPS-success state after a cached fix was rejected.
- Removed stale selectable search results while the deferred query catches up.
- Kept the panel and location marker usable across phone/desktop breakpoints, after the map projection has resized.
- Prevented sheet movement from swallowing the first click or hiding a focused control.
- Fixed narrow-screen overlap, readable wordmark backgrounds, duplicate prominent location actions and location-copy language mismatches.

## Screenshots

- [Desktop journey](desktop-journey.png): real Berri-UQAM → Montmorency result and selected route, development build.
- [Narrow phone](mobile-320-journey.png): corrected control/panel spacing at 320px.
- [Production mobile manual departure](production-mobile-manual.png): confirmed manual marker and departure guidance.
- [Atlas light theme](atlas-mobile-manual-light.png): manual-origin atlas in light mode; captured before the final wordmark backing adjustment.
- [Tablet before camera fix](production-tablet-manual.png): retained as failure evidence; marker was behind the panel.
- [Tablet after camera fix](tablet-manual-fixed.png): corrected marker position outside the panel.

Changes remain local. No deployment was performed by this verification pass.
