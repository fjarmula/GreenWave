# Fix incomplete SSH deployment activation

## Reproduction and requirement

User observed intersection stops on `https://green-wave.duckdns.org/` but continuous motion
locally. Playwright captured identical GreenWave requests: Długa 1, same ambulance origin,
density1.5, cascade on, nominal ITS,10x,1456.135606m and two intersections. Live telemetry
reported0km/h at ticks42/43 and47/48; local telemetry kept rolling. Live also lacks the
reference estimated_standard_time_sec field. The live package lacks greenwave_slowdown.

Read-only SSH inspection confirmed the old untagged images still run while release images
for3ac7625 ande621e43 are already built. No successful current pointer exists despite green CI.
The SSH-streamed bash script calls Compose run with stdin attached, allowing it to consume
the activation commands after the preflight and leave bash exiting successfully at EOF.

## Correction

- Disconnect Compose commands from the deployment script's stdin.
- Upload the checked-out deployment script separately and execute it with ssh -n from a file.
- Add regression tests for an external command that drains stdin while bash reads script code
  from stdin; assert actual activation and rollback/error propagation.
- Keep all frontend/backend application source identical to reference0b7729f.
- Validate the already-built e621e43 app images and activate backend/frontend on the VM,
  retaining existing proxy configuration, credentials, data and certificate volumes.
- Re-run the same browser scenario after activation and compare telemetry.

Do not push source, alter branches, expose secrets, or change simulation rules.
