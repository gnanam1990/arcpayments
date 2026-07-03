# Stage 8 — Scaffolder + publish (the launch)

**Goal:** `npx arcpayments create <app>` emits a working, testnet-wired agentic-commerce project
shaped like everything you've built — and `arcpayments` is published to npm as a real, installable,
documented tool. This is the finish line: a stranger goes from zero to a running paid-MCP demo in
minutes.

Read `CLAUDE.md`, `NETWORK.md`, and the whole codebase first. Repo is PUBLIC — secrets rules apply,
git-status gate before every commit.

## Part A — The scaffolder: `arcpayments create <name>`

- `arcpayments create my-app` generates a new project directory with a working starter that composes
  what the toolkit already provides: a metered MCP server with one paid tool + free tool, a buyer
  agent that pays per call, the spend guards wired in, and a `.env.example` + `README` + the
  `doctor`/`faucet`/`gateway:*` commands available.
- The emitted project **runs on Arc testnet with no manual patching** beyond filling `.env`
  (keys via `wallet:new`, funds via `faucet`).
- Template files live in the package and are copied/rendered on create. Verify the generated project
  actually installs and its tests/build pass (a generation smoke test).
- The scaffolder must NOT generate anything named to impersonate Circle/Arc; the emitted README
  carries the same "community project, not affiliated with Circle/Arc" line.

## Part B — Publish readiness (npm)

- `packages/arcpayments/package.json`: correct `name` (`arcpayments`), `version` (bump to `0.8.0` for
  this stage; `1.0.0` only when you decide it's stable), `bin`, `files` allowlist (ship `dist` +
  templates, NOT tests/src-maps/secrets), `exports`, `engines`, `repository`, `license` (MIT),
  `keywords`, and a `description` that STARTS with "Community toolkit for building on Arc (not
  affiliated with Circle/Arc) —". Prominent non-affiliation is the mitigation for the name.
- `prepublishOnly` runs typecheck + lint + test + build. `npm pack` dry-run: inspect the tarball,
  confirm no `.env`, no keys, no `src` secrets — only intended files.
- README (repo + package): what it is, the community/non-affiliation disclaimer up top, testnet
  disclaimer, quickstart (`npx arcpayments create` → `wallet:new` → `faucet` → run), the safety story,
  and links (repo, CI badge, MIT).

## Part C — Do NOT auto-publish

- **The actual `npm publish` is a human step — Claude Code prepares everything but does not publish.**
  Provide the exact publish commands + a pre-publish checklist in `docs/RELEASE.md`. Publishing needs
  npm auth and is irreversible (a bad publish can't be unpublished after 72h), so the human runs it.

## Part D — Launch polish

- A CI badge + license badge in the README (they render now that the repo is public with green CI).
- A `CONTRIBUTING.md` + basic issue templates (invites the external contribution that = recognition).
- A short `CHANGELOG.md` summarizing v0.1.0 → v0.8.0.
- Confirm the whole example still works end-to-end (doctor green on testnet; generated app builds).

## Tests first (TDD)

- [ ] `arcpayments create <name>` generates the expected file tree
- [ ] the generated project installs and its build/tests pass (generation smoke)
- [ ] `files` allowlist / pack dry-run excludes tests, src maps, and any secret patterns
- [ ] generated `.env.example` has empty values; no key material in any template
- [ ] `create` refuses to overwrite a non-empty target dir without `--force`

## Done when

- [ ] `arcpayments create` emits a project that runs on Arc testnet with no manual patching (beyond `.env`)
- [ ] package.json publish-ready; `npm pack` dry-run tarball is clean (no secrets, right files)
- [ ] README (repo + package) with non-affiliation + testnet disclaimers up top, quickstart, safety story, badges
- [ ] `docs/RELEASE.md` with the exact human publish steps + checklist; CONTRIBUTING.md, issue templates, CHANGELOG.md
- [ ] CI green; no secret committed; nothing auto-published
- [ ] Conventional Commits on branch `stage-08`, PR opened. Tag `v0.8.0` after merge; publish is a separate human step.

## Do NOT

- Do not run `npm publish` — prepare it; the human publishes.
- Do not ship tests/secrets/src-maps in the package; enforce the `files` allowlist + verify with pack dry-run.
- Do not generate Circle/Arc-impersonating names in templates; keep the non-affiliation line.
- Do not log/commit keys.
