# Stage 7 — Seller dashboard (first UI)

**Goal:** a live dashboard for the seller — real-time payments, Gateway balance, settlement status,
and the safety-guard state — that looks like a serious, distinctive fintech product, clearly *yours*,
not a Circle/Arc clone. This is the one artifact outsiders *see*, so design matters.

Read `CLAUDE.md`, `NETWORK.md`, the metered-mcp app, the Stage 4 settlement data shape, and the
Stage 6 guard state first. Repo is PUBLIC — secrets rules apply.

**Read the design skill before building UI:** `/mnt/skills/public/frontend-design/SKILL.md`. Follow its
two-pass process (plan a token system, critique it against the generic defaults, then build).

## Part A — Stack check (do first)

Determine what `metered-mcp` currently is (server-only? any web surface?). Choose the dashboard stack
to fit — **Next.js + Tailwind** is the default unless there's a reason to match something existing.
Don't bolt on a second framework needlessly. State the choice.

## Design brief (fixed)

- **Theme: dark.** **Accent: violet/purple** — this is the brand color; do NOT use Circle's blue.
- Register: clean institutional fintech (Stripe / Linear / Vercel-dashboard family), **clearly a
  community project, not official Circle/Arc**. Same neighborhood, not the same house.
- **Avoid the AI-default look** the design skill warns about: near-black + one bright accent glow is a
  tell. Spend the one "signature" moment on something true to *this* subject — sub-cent payments
  settling on-chain in real time — not a generic gradient. Monospace for amounts, addresses, tx
  hashes; a real type scale; violet used with restraint, not as neon.

## Part B — Dashboard content (real data, no fake numbers)

Wire to actual sources from earlier stages — never invent data:

1. **Live payment feed** — each paid `premium_echo` call: amount ($0.001), timestamp, payer (truncated
   0x), status (accepted → settling → completed, using the Stage 4 status vocabulary). Rows stream in.
2. **Balance card** — the seller's Gateway `available` (and deposited/withdrawing), formatted from the
   6-decimal ERC-20 correctly. Reuse `gateway:balance` logic; don't re-derive.
3. **Settlement status** — reflect the ~10-min async cadence honestly: accepted vs on-chain-completed
   are visually distinct. When a transfer completes, show it; never fake a tx link (Stage 4: Gateway
   transfers have no per-transfer hash — show status + IDs, link the explorer only for real 0x hashes).
4. **Safety panel** — surface the Stage 6 guard state: budget used / cap, rate-limit headroom,
   allowlist size, any denied payments (with reason). This makes the differentiator *visible*.

## Part C — Data path

- The server exposes the data (a read endpoint / SSE / websocket — pick per the stack) from the real
  payment + settlement + guard state. Read-only; the dashboard never signs or moves funds.
- Empty states are real invitations (per the design skill's copy guidance): "No payments yet — start
  the buyer loop" with the command, not a sad blank.
- No secrets in the browser: the dashboard reads public data + balances, never a private key.

## Part D — Quality floor (from the design skill)

- Responsive to mobile; visible keyboard focus; `prefers-reduced-motion` respected (the live feed
  must not strobe for motion-sensitive users).
- Copy: plain, active voice, sentence case, named from the user's side ("Payments", "Balance",
  "Safety" — not "webhook events"). Errors explain + direct, don't apologize.

## Done when

- [ ] stack chosen + stated; dashboard runs locally against real metered-mcp data
- [ ] live payment feed, balance card, honest settlement status, and safety panel all wired to real sources
- [ ] dark + violet, distinctly non-Circle, not the AI-default near-black+glow look; mono for amounts/hashes
- [ ] responsive, keyboard-accessible, reduced-motion respected; real empty/error states
- [ ] no private key in the browser; read-only
- [ ] a short design note in the PR: the token system + the one signature element + what you changed after self-critique
- [ ] CI green; no secret committed
- [ ] Conventional Commits on branch `stage-07`, PR opened. Tag `v0.7.0` after merge.

## Do NOT

- Do not invent payment/balance numbers — wire to real data; use honest empty states when there's none.
- Do not clone Circle/Arc branding or use their blue; this is clearly a community tool.
- Do not put any private key or signing capability in the browser — the dashboard is read-only.
- Do not settle for the generic near-black + single-accent-glow look — make one deliberate signature choice.
