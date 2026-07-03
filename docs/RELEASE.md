# RELEASE — publishing `arcpayments` to npm

Publishing is a **human step**. `npm publish` needs npm auth and is effectively irreversible (a bad
publish can't be unpublished after 72h, and a version number can never be reused). Claude Code prepares
everything; a maintainer runs the commands below.

## Prerequisites

- You are a maintainer with publish rights to the `arcpayments` npm package (or it's an unclaimed name
  and you're doing the first publish). `npm whoami` shows your logged-in user.
- **Bun** is installed (the `prepublishOnly` gate runs `bun run typecheck/lint/test/build`).
- The version in `packages/arcpayments/package.json` is the one you intend to publish, and CI is green
  on the merge commit.
- 2FA/OTP ready if your npm account requires it.

## Pre-publish checklist

- [ ] `packages/arcpayments/package.json` `version` is correct (this stage: **0.8.0**). Bump to
      `1.0.0` only when you decide the API is stable.
- [ ] `CHANGELOG.md` has an entry for this version.
- [ ] On `main` at the merged, CI-green commit; working tree clean (`git status`).
- [ ] Tarball is clean — no secrets, right files (verify below).

## 1. Verify the tarball (dry run — no publish)

```bash
cd packages/arcpayments
bun run build              # produce dist/ (no source maps)
npm pack --dry-run         # inspect the file list
```

Confirm the list contains **only**: `dist/**` (`.js` + `.d.ts`, **no `.map`**), `templates/**`,
`README.md`, `LICENSE`, `package.json`. It must **not** contain any `.env`, private keys, `src/`, or
this package's own `test/`. Scan the actual tarball to be sure:

```bash
TGZ=$(npm pack 2>/dev/null | tail -1)
tar -tzf "$TGZ"                                   # file list
tar -xzOf "$TGZ" | grep -oE '0x[a-fA-F0-9]{64}'   # must print NOTHING (no keys)
rm -f "$TGZ"
```

## 1b. Local generation smoke (pre-publish, optional but recommended)

The generated project depends on `arcpayments` from npm, so a full "install + build" can only run
against a real package. Before publishing, verify it against the **local tarball** (no network publish):

```bash
cd packages/arcpayments && bun run build
TGZ=$(npm pack 2>/dev/null | tail -1) && TARBALL="$PWD/$TGZ"
cd "$(mktemp -d)"
node "$TARBALL"/../dist/bin.js create smoke-app 2>/dev/null || npx arcpayments create smoke-app
cd smoke-app
npm install "$TARBALL"     # install THIS build of arcpayments in place of the registry version
npm install
npm run build && npm test  # the generated project builds and its test passes
```

This is a local, human-run check (it needs network for the other deps) — it is intentionally **not**
part of CI, which stays offline/fast. CI already verifies the emitted file tree, rendered content, the
empty `.env.example`, and that no template carries key material.

## 2. Publish (the irreversible step)

```bash
cd packages/arcpayments
npm publish              # runs prepublishOnly: typecheck + lint + test + build, then publishes
# add --otp=<code> if your account enforces 2FA
```

`publishConfig.access` is `public`, so no `--access` flag is needed.

## 3. Tag and verify

```bash
# from the repo root, tag the release
git tag v0.8.0
git push origin v0.8.0

# confirm it installs from the registry
npm view arcpayments version
npx arcpayments@0.8.0 --version
```

## 4. Smoke the published package end-to-end

```bash
cd /tmp && npx arcpayments@0.8.0 create smoke-app
cd smoke-app && npm install && npm run build && npm test
```

## Rollback

You can't unpublish after 72h. If a bad version ships, **publish a fixed patch version** (e.g.
`0.8.1`) — never try to reuse a number. Within 72h `npm unpublish arcpayments@<version>` is possible
but discouraged.

## Do NOT

- Do not run `npm publish` from CI or from an automated agent — it's a deliberate human action.
- Do not publish with a dirty working tree or red CI.
- Do not publish secrets: always run the tarball scan in step 1 first.
