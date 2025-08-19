// functions/api/openai.js
// Cloudflare Pages Function for OpenAI Chat Completions
// Uses verb-specific handlers (recommended for Pages Functions)

const CORS = {
  "Access-Control-Allow-Origin": "*",                // tighten to your domain if you need
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra }
  });

// Health check (GET /api/openai)
export async function onRequestGet() {
  return new Response("ok", { status: 200, headers: CORS });
}

// CORS preflight (OPTIONS /api/openai)
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// Proxy (POST /api/openai)
export async function onRequestPost(context) {
  const { env, request } = context;

  const key = env.OPENAI_API_KEY; // <-- must be named exactly like this in Pages Secrets
  if (!key) return json({ error: "OPENAI_API_KEY not set" }, 500);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload?.model || !payload?.messages) {
    return json({ error: "Missing required fields: model, messages" }, 400);
  }

  // Forward request to OpenAI
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const bodyText = await upstream.text();
  const isJSON =
    upstream.headers.get("content-type")?.includes("application/json");

  return new Response(bodyText, {
    status: upstream.status,
    headers: {
      ...(isJSON
        ? { "Content-Type": "application/json" }
        : { "Content-Type": "text/plain; charset=utf-8" }),
      ...CORS
    }
  });
}
