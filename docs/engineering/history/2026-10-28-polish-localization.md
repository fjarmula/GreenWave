# Polish default and language switching

## Requirements and approach

Default the dashboard to Polish for Kraków and expose PL/ENG on every shared header, including phone layouts. Remember explicit choices across reloads and navigation. Switch presentation in place during an active simulation. Keep geographic names, scenario time in Europe/Warsaw, API values and original diagnostic JSON intact. No new dependencies or signal actuation.

Implementation steps: add locale resolution and catalog with regression tests; connect the shared provider, switch and presentation surfaces; verify unit tests, all frontend quality checks and browser acceptance; review, commit and publish the feature branch and PR.

The language cookie is validated on the server and initializes the provider and HTML language together. Missing or unsupported preferences select Polish. The client updates presentation and the browser title without replacing simulation providers. English source messages provide catalog keys; Polish translations include dynamic messages. Raw diagnostic JSON bypasses translation.

## Verification

Run the frontend checks from `frontend/`: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build`.

Browser acceptance uses `@playwright/cli` and `frontend/scripts/smoke/localization.js` against a running mock frontend. Run the CLI from `.tmp/playwright/`; all results and screenshots stay there. Coverage includes first-visit Polish, PL/ENG on all six routes at 1440 px and 390 px, cookie persistence, invalid-cookie fallback, translated titles and switching during an active run. Existing English markup assertions now select English explicitly; new locale tests cover Polish rendering and interpolation edge cases.

## Polish copy review

Preserve GreenWave as a proper noun in Polish navigation, browser titles, estimates and comparison results. Use natural action labels and complete messages. The Home return link now separates its action from a complete simulation status, so statuses never depend on a grammatical case inherited from an English sentence. Regression tests cover the brand across the catalog and standalone status labels.
