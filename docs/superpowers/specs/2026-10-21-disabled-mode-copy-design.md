# Disabled-mode explanation: design

## Intent

The setup explanation should describe the simulation's implemented disabled-mode behavior without implying that the vehicle stops at a simulated red/yellow movement.

## Decisions

- Describe disabled mode as simulated standard traffic without signal priority. At a modelled red or yellow controlled crossing, the vehicle rolls cautiously without stopping and stays within the ordinary speed limit.
- Keep the explanation concise and in English. Preserve the enabled-mode explanation and the mode control's behavior.

## Constraints and non-goals

- The existing rolling-motion design in `2026-10-21-er-green-wave-corrections-design.md` remains authoritative for simulation behavior.
- Do not change motion, request payloads, mock timeline, API contracts, dependencies, or lockfile.
- Do not imply legal permission to cross a physical signal or make a safety claim.

## Acceptance criteria

- Mock and backend setup show the same disabled-mode explanation, with no claim that the vehicle waits at red/yellow or crosses at the speed limit in all cases.
- The text states no priority and cautious rolling behavior; enabled copy and control behavior remain unchanged.
