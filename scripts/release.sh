#!/usr/bin/env bash
# Builds a signed, notarized DMG and update zip, checks them the way Gatekeeper will,
# then publishes the GitHub release v<version> with all five files (Rachel, 2026-11-13).
# Needs (see docs/RELEASE.md): a "Developer ID Application" certificate in the login
# keychain, a notarytool keychain profile named in APPLE_KEYCHAIN_PROFILE, and the
# GitHub CLI logged in (gh auth login). No credentials are read from or written to
# this repository. NO_PUBLISH=1 stops after the checks, without publishing.
# Release notes: docs/release-notes/<version>.md if it exists, else GitHub writes them
# from the commits since the last release.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APPLE_KEYCHAIN_PROFILE:?set APPLE_KEYCHAIN_PROFILE to your notarytool profile name (docs/RELEASE.md)}"
# APPLE_KEYCHAIN is left unset: notarytool then finds the profile wherever
# store-credentials saved it. Forcing login.keychain-db fails on recent macOS (2026-11-11).
REPO=rachelkph/cherub-courier
version=$(node -p 'require("./package.json").version')
if [ -z "${NO_PUBLISH:-}" ]; then
  gh auth status >/dev/null 2>&1 || { echo "GitHub CLI is not logged in: run gh auth login (docs/RELEASE.md)." >&2; exit 1; }
  if gh release view "v${version}" -R "$REPO" >/dev/null 2>&1; then
    echo "v${version} is already released. Bump the version in package.json first." >&2
    exit 1
  fi
  [ -z "$(git status --porcelain)" ] || { echo "Commit your changes first: the release is built from the committed code." >&2; exit 1; }
  git fetch -q origin main
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Push main first: the release is tagged on origin/main." >&2; exit 1; }
fi
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "No 'Developer ID Application' certificate in your keychain (docs/RELEASE.md, step 1)." >&2
  exit 1
fi
for d in cherub/fly_light cherub/fly_medium cherub/fly_heavy cherub/hover_light cherub/rest cherub/sleep cherub/pile cherub/fx; do
  [ -d "assets/$d" ] || { echo "Sprite folder assets/$d is missing; the app would ship without art." >&2; exit 1; }
done
node scripts/icon.mjs # the app icon, from the cherub's art
npx electron scripts/dmg-background.mjs # the installer window's background

npm run lint
npm test
rm -rf out
npm run dist # builds, signs with hardened runtime, notarizes and staples the app

dmg="out/CherubCourier-${version}.dmg"
app="out/mac-universal/Cherub Courier.app"

echo "Notarizing the DMG…"
xcrun notarytool submit "$dmg" --keychain-profile "$APPLE_KEYCHAIN_PROFILE" --wait
xcrun stapler staple "$dmg"

echo "Checking…"
codesign --verify --deep --strict --verbose=2 "$app"
xcrun stapler validate "$app"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
mnt=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$dmg" >/dev/null
trap 'hdiutil detach "$mnt" >/dev/null 2>&1 || true' EXIT
spctl --assess --type execute --verbose=2 "$mnt/Cherub Courier.app"
shasum -a 256 "$dmg" | tee "$dmg.sha256"

# The update zip (what installed apps download): its app must be signed, notarized and stapled too.
zip="out/CherubCourier-${version}-mac.zip"
unz=$(mktemp -d)
ditto -x -k "$zip" "$unz"
codesign --verify --deep --strict "$unz/Cherub Courier.app"
xcrun stapler validate "$unz/Cherub Courier.app"
spctl --assess --type execute --verbose=2 "$unz/Cherub Courier.app"
grep -q "^version: ${version}$" out/latest-mac.yml || { echo "out/latest-mac.yml is not for ${version}" >&2; exit 1; }

# The same DMG under a fixed name, so this link always gets the newest version:
# https://github.com/rachelkph/cherub-courier/releases/latest/download/CherubCourier.dmg
cp "$dmg" out/CherubCourier.dmg
files=("$dmg" "$dmg.sha256" out/CherubCourier.dmg "$zip" "$zip.blockmap" out/latest-mac.yml)
if [ -n "${NO_PUBLISH:-}" ]; then
  echo "Ready (not published). Files for v${version}:"
  ls -1 "${files[@]}"
  exit 0
fi

# Publish: gh uploads every file before the release goes public, so installed apps never
# see a release whose latest-mac.yml names a zip that is not there yet.
notes=(--generate-notes)
[ -f "docs/release-notes/${version}.md" ] && notes=(--notes-file "docs/release-notes/${version}.md")
gh release create "v${version}" "${files[@]}" -R "$REPO" --target "$(git rev-parse HEAD)" --title "Cherub Courier ${version}" "${notes[@]}"
echo "Checking the published release…"
for f in "${files[@]}"; do
  name=$(basename "$f")
  size=$(gh release view "v${version}" -R "$REPO" --json assets --jq ".assets[] | select(.name == \"${name}\") | .size")
  [ "$size" = "$(stat -f %z "$f")" ] || { echo "Missing or wrong size on GitHub: ${name}" >&2; exit 1; }
done
curl -fsSL "https://github.com/${REPO}/releases/download/v${version}/latest-mac.yml" | cmp -s - out/latest-mac.yml || { echo "latest-mac.yml on GitHub does not match the build" >&2; exit 1; }
echo "Published: https://github.com/${REPO}/releases/tag/v${version}"
echo "Download link (always the newest): https://github.com/${REPO}/releases/latest/download/CherubCourier.dmg"
