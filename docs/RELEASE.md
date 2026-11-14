# Releasing Cherub Courier

A release is a signed, notarized DMG attached to a GitHub Release. Credentials never
go in this repository or through Claude: Rachel enters them herself, and they live in
her login keychain.

`[COST]` Only the Apple Developer Program ($99/yr, already paid). Everything else is free.

## One-time setup (Rachel)

1. **Developer ID certificate.** In Xcode: Settings > Accounts > your team > Manage
   Certificates > + > *Developer ID Application*. (Or create it at
   developer.apple.com > Certificates and import it.) Check:
   `security find-identity -v -p codesigning` lists `Developer ID Application: … (TEAMID)`.
2. **App-specific password.** account.apple.com > Sign-In and Security > App-Specific
   Passwords > generate one named "notarytool".
3. **Store notarization credentials in the keychain** (you type them; nothing is saved
   in the repo):
   ```sh
   xcrun notarytool store-credentials newscat-notary \
     --apple-id "<your Apple ID email>" --team-id "<TEAMID>"
   ```
   It prompts for the app-specific password.
4. **GitHub CLI** (publishes the release): `brew install gh`, then `gh auth login`
   (GitHub.com, HTTPS, log in with a web browser). Done 2026-11-13.

## Each release

1. Make sure the cherub art in `assets/cherub/` is cleared for distribution (it ships inside
   the app, and the app icon is drawn from it; `npm run release` redraws the icon with
   `node scripts/icon.mjs`).
2. Bump `version` in `package.json`, commit, push. Optionally write the notes in
   `docs/release-notes/<version>.md` (else GitHub writes them from the commits).
3. `APPLE_KEYCHAIN_PROFILE=newscat-notary npm run release`
   - Refuses to start if this version is already released, or the code is not committed
     and pushed.
   - Draws the app icon (`scripts/icon.mjs`) and the installer window's background
     (`scripts/dmg-background.mjs`: sky, arrow from the app to Applications, "Drag the
     cherub into Applications"); both stay out of git.
   - lint + tests, universal build, hardened runtime, signing, notarization and stapling
     of the app and the DMG, Gatekeeper checks (`spctl`) on the DMG, its app and the
     update zip's app, and a check that `latest-mac.yml` is for this version.
   - Publishes GitHub release `v<version>` on the pushed commit with six files: the DMG,
     its `.sha256` and a copy named `CherubCourier.dmg` (new installs; the copy keeps
     `…/releases/latest/download/CherubCourier.dmg` pointing at the newest version), the
     update zip, its `.blockmap` and `latest-mac.yml` (automatic updates). gh uploads them all before the release goes
     public. Then it checks each file's size on GitHub and that `latest-mac.yml` matches.
   - `NO_PUBLISH=1` stops after the checks without publishing.
   Installed copies from 0.4.0 on find the release within about 6 hours, download it,
   and install it on quit, or at once from "Restart to update".
4. Test on a Mac that has never run Cherub Courier (or a fresh user account): download the
   DMG from the release page (so it gets the quarantine flag), drag to Applications, open.
   It must open with no Gatekeeper warning beyond the normal "downloaded from the
   internet" prompt, and the cherub must appear.

## Local test build (no Apple account needed)

`npm run dist:adhoc` builds an ad-hoc signed app in `out/mac-universal/` without hardened
runtime or notarization. It runs on this Mac only; never publish it.

## What the packaged app locks down

- Electron fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`; the app
  loads only from its integrity-checked `app.asar`.
- Quits if launched with `--remote-debugging-port`/`--remote-debugging-pipe`.
- Dev menu and `NEWSCAT_*` dev switches are disabled.
- Entitlements: only `com.apple.security.cs.allow-jit` (V8).
- One instance at a time.
