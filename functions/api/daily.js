// functions/api/daily.js
// Daily, shared forecast set for everyone.
// - GET  /api/daily           -> returns today's set (auto-creates if missing)
// - POST /api/daily           -> admin-only: (re)generate today's set now
//
// Storage: Cloudflare KV (binding: WILLOW_DAILY_KV)
// Key format: YYYY-MM-DD

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token"
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(ctx) {
  try {
    const { env, request } = ctx;
    const today = isoDateOnly(new Date());
    const existing = await env.WILLOW_DAILY_KV.get(today, { type: "json" });
    if (existing) return json({ date: today, ...existing });

    // Not found → create now
    const created = await createDailySet(ctx);
    return json({ date: today, ...created }, 201);
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
}

export async function onRequestPost(ctx) {
  try {
    const { env, request } = ctx;

    // Simple admin check (enter once per click)
    const adminFromHeader = request.headers.get("X-Admin-Token") || "";
    const adminFromAuth   = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const supplied = adminFromHeader || adminFromAuth;
    if (!env.ADMIN_TOKEN || supplied !== env.ADMIN_TOKEN) {
      return json({ error: "Unauthorized" }, 401);
    }

    const created = await createDailySet(ctx, /*force=*/true);
    return json({ regenerated: true, ...created }, 200);
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
}

/* ------------------------- helpers ------------------------- */

async function createDailySet(ctx, force = false) {
  const { env, request } = ctx;
  const today = isoDateOnly(new Date());

  if (!force) {
    const existing = await env.WILLOW_DAILY_KV.get(today, { type: "json" });
    if (existing) return existing;
  }

  // Pull fresh candidates from your aggregator
  const base = originOf(request.url); // same-origin
  const r = await fetch(`${base}/api/forecasts?source=all&limit=120`);
  if (!r.ok) throw new Error(`/api/forecasts failed: ${r.status}`);
  const data = await r.json();
  const candidates = Array.isArray(data.results) ? data.results : [];

  // Selection policy:
  // - dedupe by normalized title
  // - rank by (liquidity desc, then recency if present)
  // - pick a balanced set across sources
  const dedup = dedupeByTitle(candidates);
  dedup.sort((a, b) => (toNum(b.liquidity) - toNum(a.liquidity)));

  // Ensure a mix: up to 8 items total (4 polymarket, 4 kalshi if available)
  const POLY = dedup.filter(x => x.source === "polymarket").slice(0, 4);
  const KAL  = dedup.filter(x => x.source === "kalshi").slice(0, 4);
  let pick = [...POLY, ...KAL];

  // If we didn’t get enough, top up from whatever remains
  if (pick.length < 8) {
    const used = new Set(pick.map(x => x.title));
    for (const row of dedup) {
      if (pick.length >= 8) break;
      if (!used.has(row.title)) {
        used.add(row.title);
        pick.push(row);
      }
    }
  }

  // Persist the exact set so it’s identical for everyone today
  const payload = {
    generated_at: new Date().toISOString(),
    count: pick.length,
    items: pick.map(slim)
  };

  await env.WILLOW_DAILY_KV.put(today, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 5 }); // keep 5 days
  return payload;
}

function slim(x) {
  return {
    source: x.source,
    title: x.title,
    url: x.url,
    implied_prob: x.implied_prob ?? x.probabilityYes ?? null,
    close_time: x.closeTimeISO ?? x.close_time ?? null,
    liquidity: x.liquidity ?? null,
    market_id: x.market_id ?? x.id ?? null
  };
}

function isoDateOnly(d) { return d.toISOString().slice(0,10); }
function originOf(url) { const u = new URL(url); return `${u.protocol}//${u.host}`; }
function toNum(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function dedupeByTitle(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = normTitle(r.title);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
function normTitle(t) {
  return (t || "").toLowerCase().replace(/\s+/g, " ").trim();
}
