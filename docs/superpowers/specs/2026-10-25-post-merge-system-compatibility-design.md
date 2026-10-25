# Post-merge system compatibility fixes

The human approved the eight findings and latent stale-ranking issue from the audit of
`7deff49`. The implementation branch is `fix/post-merge-system-compatibility`.

## Required behavior

1. Successful comparison Stop ends every unfinished local member even if terminal SSE is lost;
   existing completed/failed members retain their outcomes. Old responses never affect a new run.
2. Stop issued during route planning must stop that operation after planning, without launching
   an unseen active operation. Serialize lifecycle mutation under the existing manager lock;
   retain unknown-ID errors and pair-wide Stop behavior.
3. Retained ended streams send their latest snapshot before the terminal so completed maps have
   their final authoritative position. No fabricated telemetry or terminal-position guesses.
4. Physical arrival and signal-recovery completion remain distinct. Race readout recognizes
   ARRIVED telemetry and its frozen travel duration, including arrival before terminal delivery.
5. Comparison total route length comes from summing segments, not projecting the endpoint;
   crossing endpoints must not truncate progress. Preserve honest treatment of ambiguous geometry.
6. Driver and phone setup expose the existing ITS scenario control. Setup summary and active
   settings disclose the selected scenario; disabled mode remains NOMINAL.
7. Off-road generic and comparison summaries explicitly label driving to the access point and
   show the separate walking distance/time. On-road copy remains unchanged; comparison savings
   remain based on completed drive times.
8. Interrupted comparison dock says it is waiting only while a member still runs.
9. Clearing an incident invalidates any previous ranking response, including adapters ignoring abort.

## Constraints

Simulation only. Keep the main engine, motion and controller policy unchanged, particularly fixed
ITS hold expiry. Reuse existing UI/transport boundaries and dependencies. Pydantic remains canonical;
no contract expansion is required. Preserve unrelated changes and require verification before commits.
