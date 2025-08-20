// functions/api/forecasts.js
// Fetches markets from Polymarket, Kalshi, ProphetArena (stubbed)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet() {
  const results = [];

  // ---- Polymarket (simplified) ----
  try {
    const polyRes = await fetch("https://clob.polymarket.com/simplified-markets");
    if (polyRes.ok) {
      const polyData = await polyRes.json();
      (polyData?.data || []).slice(0, 5).forEach(m => {
        results.push({
          source: "polymarket",
          title: m.question,
          url: m.market_slug ? `https://polymarket.com/event/${m.market_slug}` : "https://polymarket.com",
          implied_prob: null
        });
      });
    }
  } catch (e) {
    results.push({ source: "polymarket", error: String(e) });
  }

  // ---- Kalshi (simplified) ----
  try {
    const kalshiRes = await fetch("https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=5");
    if (kalshiRes.ok) {
      const kalshiData = await kalshiRes.json();
      (kalshiData?.markets || []).forEach(m => {
        results.push({
          source: "kalshi",
          title: m.title,
          url: `https://kalshi.com/markets/${(m.ticker || "").toLowerCase()}`,
          implied_prob: (m.yes_price ?? 0) / 100
        });
      });
    }
  } catch (e) {
    results.push({ source: "kalshi", error: String(e) });
  }

  // ---- Prophet Arena (stub) ----
  results.push({
    source: "prophet-arena",
    title: "Prophet Arena – API pending",
    url: "https://www.prophetarena.co/",
    implied_prob: null
  });

  return new Response(JSON.stringify({
    updated_at: new Date().toISOString(),
    results
  }), { headers: { "Content-Type": "application/json", ...CORS }});
}
