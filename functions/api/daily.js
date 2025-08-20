export async function onRequest(context) {
  const today = new Date().toISOString().slice(0,10);
  const KV = context.env.WILLOW_KV; // KV binding (we add in Step 5)

  let cached = await KV.get(today);
  if (!cached) {
    const res = await fetch(`${context.env.PUBLIC_URL}/api/forecasts`);
    const data = await res.json();
    cached = JSON.stringify(data);
    await KV.put(today, cached);
  }

  return new Response(cached, { headers: { "Content-Type": "application/json" }});
}

