# Cherub Courier

**Download page: https://rachelkph.github.io/cherub-courier/**

A pixel-art cherub who flies above the macOS Dock and delivers twice-daily headlines.
Everything runs on your Mac: no accounts, no tracking, no AI.

Status: in development (milestone M6 of `docs/BUILD_PLAN.md`). No public release yet.

## Install

1. Download [CherubCourier.dmg](https://github.com/rachelkph/cherub-courier/releases/latest/download/CherubCourier.dmg) (always the newest version; older ones are on the [Releases](https://github.com/rachelkph/cherub-courier/releases) page).
2. Open it and drag **Cherub Courier** to **Applications**.
3. Open Cherub Courier from Applications. macOS asks once whether to open an app downloaded from
   the internet; choose Open. (Releases are signed and notarized by Apple.)
4. Pick your topics and sources. The cherub flies above your Dock and brings headlines
   twice a day; click him to read them.

From 0.4.0 the app updates itself: it checks GitHub for a newer release, downloads it in the background, and installs it when you quit (or from "Restart to update" in the menu bar). Versions before 0.4.0 need one manual download.

Requires macOS 12 or later (Apple silicon or Intel). To uninstall, quit Cherub Courier from the
menu bar cherub icon, choose Reset everything… first if you want your data deleted, then
drag the app to the Trash.

Privacy: nothing leaves your Mac except fetching the feeds you chose. See [PRIVACY.md](PRIVACY.md).

## Develop

Requires Node 22+ (type stripping is used to run tests on TypeScript sources) and macOS.

```sh
npm install
node node_modules/electron/install.js   # npm 11 may skip Electron's binary download
npm run dev        # build and launch
npm test           # unit tests
npm run lint       # Biome + TypeScript type check
npm run check-feeds  # liveness check of the seed feeds
npm run dist:adhoc   # local test build in out/ (this Mac only)
```

Releasing (signing, notarization, DMG): `docs/RELEASE.md`.

Menu bar cherub icon: Hide/Show, Appearance (Match Mac/Light/Dark; also the sun/moon button in the popover), Put to sleep/Wake (he sleeps on his pile until woken), Pause/Resume (he stays where he is), Snooze, Set up… (re-run setup), Reset everything… (deletes local data).

Dev-only controls (not in packaged builds):
- Menu bar cherub icon > Dev: set the unread count and the oldest unread edition's age.
- Menu bar cherub icon > Dev > Fetch edition now: fetch from your approved sources immediately.
- `NEWSCAT_DEV_STATE="unread,editionAge" npm run dev`: start in a given state.
- `NEWSCAT_DEV_FETCH=1 npm run dev`: fetch an edition on launch.
- `node scripts/fetch-edition.ts /tmp/state.json [topics]`: build an edition from all recommended sources in the terminal.

Local data lives in `~/Library/Application Support/Cherub Courier/` (`settings.json`, `state.json`, `sources-cache.json`). On first launch they are copied from the old `NewsCat` folder, which is left in place.
The curated source list is `data/sources.json`; a newer copy is fetched from this repo's `main` branch at most once a day.

The cherub delivers the news: `assets/cherub/manifest.json`, art under `assets/cherub/`.
(A walking cat was the first character; it was removed on 2026-11-11.)

Sprites and animation timings live in the manifest; swap art there without code changes.
The sprite PNGs themselves are **not in this repository** (licensing of the art is unchecked).
Put them under `assets/cherub/` (see `.gitignore`) to run the app; without them, art-dependent tests are skipped.
Docs: `docs/PRODUCT_SPEC.md`, `docs/BUILD_PLAN.md`, `docs/RELEASE.md`, `docs/VERIFIED.md`.
