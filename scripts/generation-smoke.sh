#!/usr/bin/env bash
#
# Generation smoke — proves `arcpayments create` emits a project that actually
# installs, typechecks, builds, and passes ITS OWN tests. A broken template (e.g.
# an invalid address fixture) fails here, so it can never ship. Uses the LOCAL build
# of arcpayments (packed tarball) since the package isn't published yet.
#
# Run: bash scripts/generation-smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/packages/arcpayments"

echo "› build arcpayments"
( cd "$PKG" && bun run build >/dev/null )

echo "› pack arcpayments (local tarball)"
TARBALL_NAME="$(cd "$PKG" && npm pack --silent | tail -1)"
TARBALL_ABS="$PKG/$TARBALL_NAME"
echo "  $TARBALL_ABS"

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK" "$TARBALL_ABS"; }
trap cleanup EXIT

echo "› generate a project with \`arcpayments create\`"
( cd "$WORK" && node "$PKG/dist/bin.js" create smoke-app )
APP="$WORK/smoke-app"
test -f "$APP/package.json" || { echo "✗ create did not emit a project"; exit 1; }

echo "› install (arcpayments from the local build, rest from npm)"
( cd "$APP" && npm pkg set "dependencies.arcpayments=file:$TARBALL_ABS" >/dev/null )
( cd "$APP" && npm install --no-audit --no-fund --loglevel=error )

echo "› typecheck + build + TEST the generated project"
( cd "$APP" && npm run typecheck )
( cd "$APP" && npm run build )
( cd "$APP" && npm test )

echo "✓ generation smoke passed — the emitted project installs, builds, and its tests pass"
