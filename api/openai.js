// api/openai.js
export async function onRequestPost(context) {
  const body = await context.request.json();
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${context.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return new Response(await resp.text(), { status: resp.status });
}
