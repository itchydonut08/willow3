export async function onRequestGet(context) {
  const polyRes = await fetch(`${POLYMARKET_API}/markets`);
  const kalshiRes = await fetch(`${KALSHI_API}/markets`);
  // ProphetArena endpoint goes here

  const polyData = await polyRes.json();
  const kalshiData = await kalshiRes.json();

  return new Response(JSON.stringify({
    polymarket: polyData,
    kalshi: kalshiData,
  }), { headers: { "Content-Type": "application/json" }});
}
