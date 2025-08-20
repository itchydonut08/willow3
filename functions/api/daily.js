// functions/api/forecasts.js
// Normalizes market-implied probabilities from Polymarket + Kalshi.
// Usage:  GET /api/forecasts?source=all&q=rate,cpi&limit=50
//         source: 'polymarket' | 'kalshi' | 'all' (default: 'all')
//         q: comma-separated keywords to filter titles (case-insensitive)
//         limit: max results per source (default 50)

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: cors()
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const source = (url.searchParams.get("source") || "all").toLowerCase();
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
  const terms = q ? q.split(",").map(s => s.trim()).filter(Boolean) : [];

  const want = (name) => source === "all" || source === name;

  const tasks = [];
  if (want("polymarket")) tasks.push(fetchPolymarket({ terms, limit }));
  if (want("kalshi")) tasks.push(fetchKalshi({ terms, limit }));
  if (want("prophet") || want("prophet-arena")) tasks.push(fetchProphetArenaStub());

  const lists = await Promise.allSettled(tasks);
  const data = lists.flatMap(r => r.status === "fulfilled" ? r.value : []);

  return json({
    updated_at: new Date().toISOString(),
    count: data.length,
    results: data.sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))
  });
}

/* --------------------------- Polymarket (public) --------------------------- */
// Docs: CLOB REST base + Gamma + Midpoints.
// - Base (CLOB REST): https://clob.polymarket.com
// - Gamma (metadata):  https://gamma-api.polymarket.com
// - Get Markets:       GET {clob}/simplified-markets?next_cursor=... (paginated)
// - Get Midpoints:     POST {clob}/midpoints  with [{ token_id }]
async function fetchPolymarket({ terms, limit }) {
  const CLOB = "https://clob.polymarket.com";
  const SIMPLIFIED = `${CLOB}/simplified-markets`; // paginated; we’ll take first page
  const res = await fetch(SIMPLIFIED, { cf: { cacheTtl: 10, cacheEverything: true } });
  if (!res.ok) return [];
  const payload = await res.json();

  const markets = (payload?.data || [])
    .filter(m => m?.active && !m?.closed)
    .filter(m => Array.isArray(m.tokens) && m.tokens.length === 2);

  // keyword filter on title/question if provided
  const filtered = terms.length
    ? markets.filter(m => {
        const text = `${m?.question || ""} ${m?.category || ""}`.toLowerCase();
        return terms.some(t => text.includes(t));
      })
    : markets;

  // Build midpoints request for the "Yes" token if it exists; else first token
  const picks = filtered.slice(0, limit).map(m => {
    const yes = m.tokens.find(t => /yes/i.test(t?.outcome)) || m.tokens[0];
    return { market: m, token_id: yes?.token_id };
  }).filter(x => x.token_id);

  if (picks.length === 0) return [];

  const midReq = await fetch(`${CLOB}/midpoints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params: picks.map(p => ({ token_id: p.token_id })) })
  });
  const mids = midReq.ok ? await midReq.json() : {};

  // Normalize
  return picks.map(({ market, token_id }) => {
    const mid = num(mids[token_id]);
    const prob = clamp01(mid); // 0..1
    return {
      source: "polymarket",
      market_id: market.condition_id,
      title: market.question,
      category: market.category || null,
      close_time: market?.end_date_iso || null,
      implied_prob: prob,
      price: prob,               // same as prob in $1 markets
      yes_token_id: token_id,
      url: market?.market_slug ? `https://polymarket.com/event/${market.market_slug}` : "https://polymarket.com",
      liquidity: undefined       // Polymarket doesn’t expose a single "liquidity" number here
    };
  });
}

/* ----------------------------- Kalshi (public) ---------------------------- */
// Docs (no auth needed for market data):
// Base: https://api.elections.kalshi.com/trade-api/v2
// - Get Markets:  GET /markets?status=open[&limit=N][&series_ticker=...]
// Each market has yes_price (cents) & title; we filter by keywords client-side.
async function fetchKalshi({ terms, limit }) {
  const BASE = "https://api.elections.kalshi.com/trade-api/v2";
  const url = `${BASE}/markets?status=open&limit=${limit}`;
  const res = await fetch(url, { cf: { cacheTtl: 10, cacheEverything: true } });
  if (!res.ok) return [];

  const data = await res.json();
  let markets = data?.markets || [];

  if (terms.length) {
    markets = markets.filter(m => {
      const text = `${m?.title || ""} ${m?.ticker || ""} ${m?.event_ticker || ""}`.toLowerCase();
      return terms.some(t => text.includes(t));
    });
  }

  return markets.slice(0, limit).map(m => {
    const yesCents = num(m?.yes_price);     // e.g., 38 => $0.38 => 0.38 prob
    const prob = clamp01(yesCents / 100);
    return {
      source: "kalshi",
      market_id: m?.ticker,
      title: m?.title,
      category: m?.category || null,        // not always present on markets payload
      event_ticker: m?.event_ticker || null,
      implied_prob: prob,
      price_cents: yesCents,
      url: m?.url || `https://kalshi.com/markets/${(m?.ticker || "").toLowerCase()}`,
      liquidity: m?.volume ?? undefined
    };
  });
}

/* ------------------------- Prophet Arena (placeholder) -------------------- */
// As of now, Prophet Arena’s site explains the benchmark & shows leaderboards,
// but no stable public JSON API is documented. This stub keeps the interface
// consistent and can be upgraded the moment an API is published.
async function fetchProphetArenaStub() {
  return [{
    source: "prophet-arena",
    market_id: null,
    title: "Prophet Arena (models vs. markets) – API pending",
    implied_prob: null,
    url: "https://www.prophetarena.co/",
    note: "When Prophet Arena publishes a public events API, we can map it here."
  }];
}

/* --------------------------------- utils --------------------------------- */
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors() }
  });

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
});

function clampInt(v, min, max, dflt) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
const num = (x) => (typeof x === "string" ? Number(x) : Number(x));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
