# Changelog

## 1.1.0-beta.5

- Kept the authoritative simulation at 60Hz while reducing full-state broadcasts to 30Hz.
- Added jitter-aware interpolation, foreground recovery, and browser runtime metrics.
- Added four-player ownership markers, attack-direction silhouettes, and attacker-to-impact hit links.
- Differentiated fighter attack key poses and clarified NOVA gravity-field range.
- Improved low-usage down aerials, BLAZE neutral air, BOLT down special, and narrow up tilts.
- Added Chromium E2E coverage for responsive layout, four-client room flow, reconnect, 80–150ms latency changes, 2% packet loss, FPS, snapshot rate, and particle budgets.
- Added a desktop visual-regression baseline and documented the browser test workflow.

## 1.1.0-beta.4

- Reworked grounded Z input: tap for jab/tilt, deliberate 14-frame hold for smash charge.
- Locked buffered tilt/smash intent so movement-state changes cannot turn it into a dash attack.
- Added charge-scaled travel to NOVA side and up warps.
- Added simultaneous melee trade resolution without player-slot priority.
- Split stale-move tracking for tilt and smash variants.
- Rebuilt dash, pivot, braking, dash jump momentum, and fighter-specific movement tuning.
- Added pose-history dash afterimages and simplified high-cost combat effects.
- Reworked NOVA warp, smash charge, BLAZE counter, shield break, hit, and launch presentation.
- Rebuilt the HUD around accumulated damage, shield color, stock icons, and a portrait ultimate ring.
- Cross-checked shield, parry, dodge, grab, tech, ledge, freefall, and recovery behavior.
- Converted Neon Deck to solid ground and hardened platform collision.
- Expanded training tutorials, command help, BOT selection, and input history.
- Added adaptive effect quality and rendering caches for four-player performance.

## 1.1.0-beta.3

- Added in-game patch notes, automatic first-open announcements, and `/releases.json`.
- Added automated version consistency checks.

## 1.1.0-beta.2

- Revalidated Ultimate-style shield pokes, grabs, dodges, ledge vulnerability, and recovery.

## 1.1.0-beta.1

- Added package-driven game and protocol versions.
- Added the initial Ultimate-style combat, movement, defense, grab, recovery, and state-system pass.
