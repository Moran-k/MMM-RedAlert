# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Replace Node.js `https` module with built-in `fetch` and `AbortSignal.timeout` in `node_helper.js`
- Bump minimum Node.js requirement to `>=17.3.0` (required for `AbortSignal.timeout`)

### Added

- ESLint flat config (`eslint.config.mjs`) covering Node.js and browser environments
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1)
- `.github/dependabot.yaml` for monthly npm dependency updates
- `.gitignore`
- `## Update` section in README
- Trailing commas in all README config examples

### Fixed

- `MagicMirror²` typo in `package.json` keywords (was `MagicMirror2`)

## [1.0.0] - 2025-05-01

### Added

- Real-time polling of the official Pikud HaOref API every 2 seconds
- Filter alerts by city/area name with bidirectional partial matching
- Filter alerts by category (missiles, hostile aircraft, terrorist infiltration, news flash, etc.)
- Full-screen pulsing red overlay with slide-in animation
- Shows affected cities (up to 10, with overflow count), alert type, and Pikud HaOref safety instructions in Hebrew
- Countdown progress bar showing time remaining before auto-dismiss
- Auto-dismiss after configurable duration (default: 90 seconds)
- Deduplication — same alert won't re-trigger while it's active on screen
- Poll guard to prevent connection pile-up when the API is slow
- Rate-limited error logging to avoid flooding PM2 logs during outages
- Zero runtime npm dependencies (uses Node.js built-in `fetch`)
- Full RTL (right-to-left) Hebrew text support in CSS
