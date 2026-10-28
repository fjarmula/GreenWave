# Phone header and setup scrolling

## Requirement and diagnosis

Keep ER–GreenWave and Kraków readable alongside PL/ENG and the theme controls on phones. Allow scrolling from the incident heading through the entire expanded setup form; keep the primary dispatch action reachable.

Browser reproduction confirmed that the Home brand wrapped at 393 px and overlapped controls at 320 px. The setup sheet pinned its collapsed slot (incident, vehicle and summary), while only its details slot scrolled.

## Implementation and acceptance

Keep the brand name unbroken and place the city below it on phones. Allow the language and theme groups to wrap when the available width requires it. The Home content clears the measured header height when controls wrap. Desktop branding stays inline.

Setup sheets opt into one scrolling surface when expanded, including Driver, GreenWave, Standard and Comparison setup. The grabber stays accessible, collapsing restores the scroll position, and snap/peek measurements account for scrolling. Live telemetry retains the existing pinned-summary behavior. The dispatch action remains outside the scrolling sheet.

Verification uses the frontend quality checks and `frontend/scripts/smoke/mobile-layout.js` through `@playwright/cli`, with artifacts under `.tmp/playwright/`. Browser coverage includes 320, 393 and 430 px, PL/ENG, light/dark themes, scrolling from the setup heading, snap restoration and the dispatch action. Real iPhone Safari touch behavior still needs confirmation on hardware.

## Verification results

Frontend lint, typecheck, formatting, 1,199 tests and the production build passed. Chromium with touch emulation and WebKit at phone viewport sizes passed all 12 header combinations per engine plus portrait/landscape scrolling, header clearance and collapsed-scroll restoration. Mobile WebKit does not support Playwright wheel input, so its scrolling check used phone-sized desktop WebKit. Physical iPhone Safari remains a hardware follow-up.
