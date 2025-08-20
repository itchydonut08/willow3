// functions/api/forecasts.js
// GET /api/forecasts?source=all|polymarket|kalshi&q=fed,cpi&limit=50
// Returns normalized: { source, title, url, implied_prob (0..1), close_time, liquidity, market_id }

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
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

/* ---------------- Polymarket (public) ---------------- */
async function fetchPolymarket({ terms, limit }) {
  const CLOB = "https://clob.polymarket.com";
  const res = await fetch(`${CLOB}/simplified-markets`, { cf: { cacheTtl: 10, cacheEverything: true } });
  if (!res.ok) return [];
  const payload = await res.json();
  const markets = (payload?.data || [])
    .filter(m => m?.active && !m?.closed && Array.isArray(m.tokens) && m.tokens.length >= 2);

  const filtered = terms.length
    ? markets.filter(m => {
        const text = `${m?.question || ""} ${m?.category || ""}`.toLowerCase();
        return terms.some(t => text.includes(t));
      })
    : markets;

  const picks = filtered.slice(0, limit).map(m => {
    const yes = m.tokens.find(t => /yes/i.test(t?.outcome)) || m.tokens[0];
    return { market: m, token_id: yes?.token_id };
  }).filter(x => x.token_id);

  if (picks.length === 0) return [];
  const mid = await fetch(`${CLOB}/midpoints`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params: picks.map(p => ({ token_id: p.token_id })) })
  });
  const mids = mid.ok ? await mid.json() : {};

  return picks.map(({ market, token_id }) => {
    const prob = clamp01(Number(mids[token_id] ?? 0));
    return {
      source: "polymarket",
      market_id: market.condition_id,
      title: market.question,
      category: market.category || null,
      close_time: market?.end_date_iso || null,
      implied_prob: prob,
      price: prob,
      yes_token_id: token_id,
      url: market?.market_slug ? `https://polymarket.com/event/${market.market_slug}` : "https://polymarket.com",
      liquidity: undefined
    };
  });
}

/* ---------------- Kalshi (public) ---------------- */
async function fetchKalshi({ terms, limit }) {
  const BASE = "https://api.elections.kalshi.com/trade-api/v2";
  const res = await fetch(`${BASE}/markets?status=open&limit=${limit}`, { cf: { cacheTtl: 10, cacheEverything: true } });
  if (!res.ok) return [];
  let markets = (await res.json())?.markets || [];
  if (terms.length) {
    markets = markets.filter(m => {
      const text = `${m?.title || ""} ${m?.ticker || ""} ${m?.event_ticker || ""}`.toLowerCase();
      return terms.some(t => text.includes(t));
    });
  }
  return markets.slice(0, limit).map(m => {
    const cents = Number(m?.yes_price ?? m?.last_price ?? 0);
    const prob = clamp01(cents / 100);
    return {
      source: "kalshi",
      market_id: m?.ticker,
      title: m?.title,
      category: m?.category || null,
      event_ticker: m?.event_ticker || null,
      implied_prob: prob,
      price_cents: cents,
      url: m?.url || `https://kalshi.com/markets/${(m?.ticker || "").toLowerCase()}`,
      liquidity: m?.volume ?? undefined
    };
  });
}

/* ------------- Prophet Arena (stub) ------------- */
async function fetchProphetArenaStub() {
  return [{
    source: "prophet-arena",
    market_id: null,
    title: "Prophet Arena – API pending",
    implied_prob: null,
    url: "https://www.prophetarena.co/",
    note: "Swap this in once a public API is available."
  }];
}

/* ------------- utils ------------- */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", ...CORS }
});
const clampInt = (v, min, max, dflt) => {
  const n = Number.parseInt(v ?? "", 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
