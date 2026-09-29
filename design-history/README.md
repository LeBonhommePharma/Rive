# Preserved Rive design

`rive-transit-inspired-2026-09-06.zip` preserves the working UI immediately before the brand recoloring requested on September 6, 2026. It contains source, fonts, configuration, and scripts. It deliberately omits shared GTFS data and installed dependencies. It is an uncommitted source snapshot, not a deployed release.

The active design retains the layout and Outfit / IBM Plex Mono pairing. Only the interface palette changes to Le Bonhomme Pharma's colors. Agency route colors remain sourced from the transit data.

Color provenance: the supplied `Color and type pairings.zip`, `handoff-palette-v2/colors_and_type.css`, and the website's current `tokens.css` (dark colors at lines 35–51; accessible light tones at 346–384), verified September 6, 2026. The archive's unrelated patch instructions were not applied. `public/Transit/brand.css` is the shared Rive palette.

Validation after the brand pass: production build and TypeScript check pass; all 181 tests pass; ESLint reports no errors and five pre-existing unused-variable warnings. The new regression test verifies that the exact installed MapLibre worker and its imported sibling are shipped together. HTTP checks confirmed the worker pair, shared palette, standalone data paths, and matching CSP startup nonces. Desktop/mobile layouts and core search interactions were inspected before the palette change. A final browser visual check was blocked by automatic approval review due to the account usage limit, so the recolored screenshots and repaired map rendering remain visually unverified. No deployment was performed.
