/**
 * The seller dashboard page (Stage 7) — a single, self-contained HTML document.
 *
 * Design: dark, violet/purple brand accent (deliberately NOT Circle blue), clean
 * institutional-fintech register, clearly a community tool. The background is a
 * violet-tinted ink (not the AI-default pure near-black), and the settlement
 * lifecycle has its OWN semantic hues (amber = accepted off-chain, mint = on-chain
 * completed, rose = failed/denied) so violet is a structural brand mark, not a lone
 * neon glow. IBM Plex Mono is the identity face — amounts, addresses and hashes are
 * the subject. The signature element is the **sub-cent earned odometer**: it makes
 * fractions-of-a-cent legible and ticks on each real accepted payment (motion is
 * disabled under prefers-reduced-motion, so the live feed never strobes).
 *
 * The page fetches `/api/state` and subscribes to `/api/stream` (SSE). It renders
 * REAL data only, with honest empty/error states. No key or signing in the browser.
 */
export function renderDashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>metered-mcp · seller</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
:root {
  --ink: #14121c;        /* violet-tinted ink — NOT pure near-black */
  --surface: #1c1a28;
  --surface-2: #232032;
  --line: #322e46;
  --text: #eceaf4;
  --muted: #9a93b4;
  --violet: #8b6dff;     /* brand accent — used with restraint */
  --violet-dim: #5b48b8;
  --amber: #e0a24e;      /* accepted (off-chain, awaiting on-chain) */
  --mint: #4fd8a6;       /* on-chain completed */
  --rose: #f2678c;       /* failed / denied */
  --radius: 12px;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --body: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background:
    radial-gradient(1100px 520px at 82% -10%, rgba(139,109,255,0.10), transparent 60%),
    var(--ink);
  color: var(--text);
  font-family: var(--body);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}
.wrap { max-width: 1120px; margin: 0 auto; padding: 28px 20px 64px; }

/* ---- top bar ---- */
.top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 26px; }
.brand { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.wordmark { font-family: var(--display); font-weight: 700; font-size: 20px; letter-spacing: -0.01em; }
.wordmark .dot { color: var(--violet); }
.eyebrow { font-size: 12px; color: var(--muted); }
.chips { display: flex; gap: 8px; align-items: center; }
.chip { font-family: var(--mono); font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; }
.live { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 11px; color: var(--muted); }
.live .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--mint); box-shadow: 0 0 0 0 rgba(79,216,166,0.5); animation: pulse 2.4s ease-out infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(79,216,166,0.45); } 70% { box-shadow: 0 0 0 7px rgba(79,216,166,0); } 100% { box-shadow: 0 0 0 0 rgba(79,216,166,0); } }

.eyebrow-label { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin: 0 0 12px; font-weight: 600; }
.grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 16px; margin-bottom: 16px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; }

/* ---- signature: sub-cent earned odometer (the mono number treatment IS the signature,
   no gradient fill — restraint over glow) ---- */
.odo { position: relative; }
.odo .amount { font-family: var(--mono); font-weight: 600; letter-spacing: -0.02em; line-height: 1; margin-top: 8px; display: flex; align-items: baseline; gap: 2px; }
.odo .unit { color: var(--muted); font-size: 15px; margin-right: 8px; }
.odo .whole { font-size: clamp(40px, 8vw, 68px); color: var(--text); }
.odo .frac { font-size: clamp(40px, 8vw, 68px); color: var(--violet); }
.odo .sub { color: var(--muted); font-size: 13px; margin-top: 12px; }
.odo.tick .frac { animation: tick 520ms ease-out; }
@keyframes tick { 0% { transform: translateY(-0.14em); opacity: 0.35; } 100% { transform: translateY(0); opacity: 1; } }
.counts { display: flex; gap: 18px; margin-top: 16px; flex-wrap: wrap; }
.count { font-family: var(--mono); font-size: 13px; color: var(--muted); }
.count b { color: var(--text); font-weight: 600; }
.count .swatch { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.sw-accepted { background: var(--amber); }
.sw-completed { background: var(--mint); }
.sw-failed { background: var(--rose); }

/* ---- balance ---- */
.bal .big { font-family: var(--mono); font-size: 34px; font-weight: 600; letter-spacing: -0.02em; }
.bal .big .u { font-size: 15px; color: var(--muted); margin-left: 6px; }
.bal dl { display: grid; grid-template-columns: 1fr auto; gap: 8px 12px; margin: 16px 0 0; }
.bal dt { color: var(--muted); font-size: 13px; }
.bal dd { margin: 0; font-family: var(--mono); font-size: 13px; text-align: right; }
.addr { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.notice { color: var(--muted); font-size: 13px; }
.notice code { font-family: var(--mono); color: var(--text); background: var(--surface-2); padding: 1px 6px; border-radius: 5px; }

/* ---- safety ---- */
.meter { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; margin: 8px 0 4px; }
.meter > i { display: block; height: 100%; background: linear-gradient(90deg, var(--violet-dim), var(--violet)); border-radius: 999px; }
.safety .row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 13px; margin-top: 14px; }
.safety .row .k { color: var(--muted); }
.safety .row .v { font-family: var(--mono); }
.tag { font-family: var(--mono); font-size: 11px; border: 1px solid var(--line); border-radius: 6px; padding: 2px 7px; color: var(--muted); }
.denials { margin-top: 14px; }
.denial { font-size: 12px; color: var(--rose); font-family: var(--mono); margin-top: 6px; }

/* ---- feed ---- */
.feed-head { display: flex; align-items: baseline; justify-content: space-between; }
.feed { margin-top: 12px; }
.frow { display: grid; grid-template-columns: 108px 1fr auto auto; gap: 14px; align-items: center;
  padding: 12px 4px; border-top: 1px solid var(--line); }
.frow:first-child { border-top: none; }
.frow.enter { animation: enter 420ms ease-out; }
@keyframes enter { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.frow .amt { font-family: var(--mono); font-weight: 600; }
.frow .amt .u { color: var(--muted); font-weight: 400; font-size: 12px; margin-left: 4px; }
.frow .payer { font-family: var(--mono); font-size: 13px; color: var(--muted); }
.frow .time { font-family: var(--mono); font-size: 12px; color: var(--muted); text-align: right; }
.pill { font-family: var(--mono); font-size: 11px; padding: 3px 9px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; }
.pill .lead { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.p-queued { color: var(--muted); border-color: var(--line); }
.p-queued .lead { background: var(--muted); }
.p-accepted { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 40%, transparent); }
.p-accepted .lead { background: var(--amber); }
.p-completed { color: var(--mint); border-color: color-mix(in srgb, var(--mint) 45%, transparent); }
.p-completed .lead { background: var(--mint); }
.p-failed { color: var(--rose); border-color: color-mix(in srgb, var(--rose) 40%, transparent); }
.p-failed .lead { background: var(--rose); }
.explorer { color: var(--violet); text-decoration: none; font-family: var(--mono); font-size: 12px; }
.explorer:hover { text-decoration: underline; }
.empty { text-align: center; padding: 40px 16px; color: var(--muted); }
.empty .cmd { display: inline-block; margin-top: 12px; font-family: var(--mono); font-size: 13px; color: var(--text); background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.note { color: var(--muted); font-size: 12px; margin-top: 14px; border-top: 1px solid var(--line); padding-top: 12px; }

a:focus-visible, :focus-visible { outline: 2px solid var(--violet); outline-offset: 2px; border-radius: 4px; }

@media (max-width: 760px) {
  .grid { grid-template-columns: 1fr; }
  .frow { grid-template-columns: 84px 1fr auto; }
  .frow .time { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .live .pulse { animation: none; }
  .odo.tick .frac { animation: none; }
  .frow.enter { animation: none; }
}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <span class="wordmark">metered-mcp<span class="dot">.</span></span>
      <span class="eyebrow">seller dashboard · community project, not affiliated with Circle/Arc</span>
    </div>
    <div class="chips">
      <span class="chip" id="chip-network">Arc testnet</span>
      <span class="chip" id="chip-price">$0.001 / call</span>
      <span class="live"><span class="pulse"></span><span id="live-label">connecting…</span></span>
    </div>
  </header>

  <section class="grid">
    <div class="card odo" aria-label="Earned">
      <p class="eyebrow-label">Earned · accepted by Gateway</p>
      <div class="amount"><span class="unit">USDC</span><span class="whole" id="odo-whole">0</span><span class="frac" id="odo-frac">.000000</span></div>
      <div class="counts" id="counts"></div>
      <p class="sub">Sub-cent payments, credited the instant Gateway accepts them.</p>
    </div>
    <div class="card safety" aria-label="Safety">
      <p class="eyebrow-label">Safety</p>
      <div id="safety-body"></div>
    </div>
  </section>

  <section class="grid">
    <div class="card feed-card" aria-label="Payments">
      <div class="feed-head">
        <p class="eyebrow-label" style="margin:0">Payments</p>
        <span class="tag" id="feed-count">0</span>
      </div>
      <div class="feed" id="feed"></div>
      <p class="note" id="settle-note"></p>
    </div>
    <div class="card bal" aria-label="Balance">
      <p class="eyebrow-label">Gateway balance</p>
      <div id="balance-body"></div>
    </div>
  </section>
</div>

<script>
const $ = (id) => document.getElementById(id);
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const seen = new Set();
let lastEarned = null;
const EXPLORER = "https://testnet.arcscan.app/tx/";

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

function renderOdometer(s) {
  const [whole, frac] = String(s.earned ?? "0").split(".");
  $("odo-whole").textContent = whole ?? "0";
  $("odo-frac").textContent = "." + (frac ?? "0").padEnd(6, "0");
  if (lastEarned !== null && s.earned !== lastEarned && !reduce) {
    const odo = document.querySelector(".odo");
    odo.classList.remove("tick"); void odo.offsetWidth; odo.classList.add("tick");
  }
  lastEarned = s.earned;
  const counts = $("counts"); counts.replaceChildren();
  const mk = (sw, label, n) => { const c = el("span", "count"); const s2 = el("span", "swatch " + sw); c.append(s2, el("b", null, String(n)), document.createTextNode(" " + label)); return c; };
  counts.append(mk("sw-accepted", "accepted", s.accepted), mk("sw-completed", "on-chain", s.completed), mk("sw-failed", "failed", s.failed));
}

function renderBalance(b) {
  const body = $("balance-body"); body.replaceChildren();
  if (b.state !== "ok") {
    const p = el("p", "notice"); p.textContent = b.error || "Balance unavailable.";
    body.append(p); return;
  }
  const big = el("div", "big"); big.append(document.createTextNode(b.available ?? "0"), el("span", "u", "USDC available"));
  const dl = document.createElement("dl");
  const pair = (k, v) => { dl.append(el("dt", null, k), el("dd", null, (v ?? "0") + " USDC")); };
  pair("Deposited", b.deposited); pair("Withdrawing", b.withdrawing); pair("Withdrawable", b.withdrawable); pair("Wallet (not in Gateway)", b.wallet);
  const addr = el("p", "addr", b.addressShort ? "seller " + b.addressShort : "");
  body.append(big, dl, addr);
}

function safetyRow(k, v) { const r = el("div", "row"); r.append(el("span", "k", k), el("span", "v", v)); return r; }

function renderSafety(s) {
  const body = $("safety-body"); body.replaceChildren();
  if (!s.configured) {
    const p = el("p", "notice");
    p.append(document.createTextNode("No spend guard on this buyer path yet. Configure limits with "), (() => { const c = el("code"); c.textContent = "ARC_GUARD_*"; return c; })(), document.createTextNode(" to bound an autonomous buyer."));
    body.append(p); return;
  }
  if (s.budget) {
    const meter = el("div", "meter"); const i = document.createElement("i"); i.style.width = Math.min(100, s.budget.pct ?? 0) + "%"; meter.append(i);
    body.append(safetyRow("Budget used", s.budget.cap ? (s.budget.used + " / " + s.budget.cap + " USDC") : (s.budget.used + " USDC")), meter);
  }
  if (s.rate) body.append(safetyRow("Rate headroom", s.rate.headroom + " of " + s.rate.max + " left this window"));
  if (s.perPaymentMax) body.append(safetyRow("Per-payment max", s.perPaymentMax + " USDC"));
  if (s.humanGateThreshold) body.append(safetyRow("Human-gate ≥", s.humanGateThreshold + " USDC"));
  body.append(safetyRow("Allowlist", s.allowlistSize + (s.allowlistSize === 1 ? " recipient" : " recipients")));
  const wrap = el("div", "denials");
  if (!s.denials || s.denials.length === 0) { wrap.append(safetyRow("Denied payments", "0 — nothing blocked")); }
  else { wrap.append(safetyRow("Denied payments", String(s.denials.length))); for (const d of s.denials.slice(0, 3)) wrap.append(el("div", "denial", "✗ " + d.guard + " · " + d.payerShort + " · " + d.reason)); }
  body.append(wrap);
}

function renderFeed(feed, price) {
  const box = $("feed"); box.replaceChildren();
  $("feed-count").textContent = String(feed.length);
  if (feed.length === 0) {
    const e = el("div", "empty");
    e.append(el("div", null, "No payments yet. Start the buyer loop to see them stream in."));
    e.append(el("div", "cmd", "bun run --filter metered-mcp start   ·   then run the buyer agent"));
    box.append(e); return;
  }
  const LABEL = { queued: "Queued", accepted: "Accepted", completed: "On-chain", failed: "Failed" };
  for (const r of feed) {
    const row = el("div", "frow" + (seen.has(r.id) || reduce ? "" : " enter"));
    seen.add(r.id);
    const amt = el("div", "amt"); amt.append(document.createTextNode(r.amount), el("span", "u", "USDC"));
    const pill = el("span", "pill p-" + r.status); pill.append(el("span", "lead"), document.createTextNode(LABEL[r.status] || r.status));
    let tail;
    if (r.txHash) { tail = el("a", "explorer"); tail.href = EXPLORER + r.txHash; tail.target = "_blank"; tail.rel = "noreferrer"; tail.textContent = "explorer ↗"; }
    else { tail = el("span", "time", new Date(r.at).toLocaleTimeString()); }
    row.append(amt, el("div", "payer", r.payerShort), pill, tail);
    if (r.error) { const er = el("div", "denial", r.error); er.style.gridColumn = "1 / -1"; row.append(er); }
    box.append(row);
  }
}

function apply(model) {
  $("chip-network").textContent = model.seller.network;
  $("chip-price").textContent = model.seller.price + " / call";
  $("settle-note").textContent = model.settlement.note;
  renderOdometer(model.settlement);
  renderBalance(model.balance);
  renderSafety(model.safety);
  renderFeed(model.feed, model.seller.price);
}

async function boot() {
  try { const res = await fetch("/api/state"); if (res.ok) apply(await res.json()); } catch (_) {}
  try {
    const es = new EventSource("/api/stream");
    es.onopen = () => { $("live-label").textContent = "live"; };
    es.onmessage = (ev) => { try { apply(JSON.parse(ev.data)); } catch (_) {} };
    es.onerror = () => { $("live-label").textContent = "reconnecting…"; };
  } catch (_) { $("live-label").textContent = "offline"; }
}
boot();
</script>
</body>
</html>`;
}
