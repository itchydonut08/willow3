// functions/api/daily.js
// Returns a single “daily forecast set” for everyone.
// Stores/retrieves from KV namespace bound as WILLOW_KV.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
const json = (obj, status=200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS }});

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestGet(context) {
  const { env, request } = context;
  const today = dateInTZ("America/New_York");

  // check KV
  let cached = await env.WILLOW_KV.get(today, { type: "json" });
  if (cached) return json({ date: today, ...cached });

  // if none: fetch fresh
  const base = new URL(request.url).origin;
  const res = await fetch(`${base}/api/forecasts`);
  if (!res.ok) return json({ error: "failed to fetch forecasts" }, 502);

  const data = await res.json();
  const picks = (data.results || []).slice(0, 8); // just take first 8

  const payload = { generated_at: new Date().toISOString(), count: picks.length, items: picks };
  await env.WILLOW_KV.put(today, JSON.stringify(payload), { expirationTtl: 60*60*24*7 });

  return json({ date: today, ...payload }, 201);
}

function dateInTZ(tz) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit" });
  return f.format(new Date()); // returns YYYY-MM-DD
}
