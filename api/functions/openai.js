// functions/api/openai.js

// Small helper for JSON responses
const j = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

// --- CORS (adjust origins if you plan to call cross-origin) ---
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",          // change to your domain if needed
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Health check (GET /api/openai)
export async function onRequestGet() {
  return new Response("ok", { status: 200, headers: CORS_HEADERS });
}

// CORS preflight (OPTIONS /api/openai)
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Proxy to OpenAI (POST /api/openai)
export async function onRequestPost(context) {
  try {
    // Ensure secret exists
    const key = context.env.OPENAI_API_KEY;
    if (!key) {
      return j({ error: "OPENAI_API_KEY not set" }, 500, CORS_HEADERS);
    }

    // Parse body (expecting standard Chat Completions payload)
    const reqBody = await context.request.json();

    // Basic guard
    if (!reqBody || !reqBody.model || !reqBody.messages) {
      return j(
        { error: "Missing required fields: model, messages" },
        400,
        CORS_HEADERS
      );
    }

    // Forward to OpenAI
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });

    // Pass through status & body; normalize headers
    const text = await upstream.text();
    // Try to pass JSON as JSON, otherwise plain text
    const isJSON =
      upstream.headers.get("content-type")?.includes("application/json");

    return new Response(text, {
      status: upstream.status,
      headers: {
        ...(isJSON
          ? { "Content-Type": "application/json" }
          : { "Content-Type": "text/plain; charset=utf-8" }),
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    return j({ error: String(err?.message || err) }, 500, CORS_HEADERS);
  }
}
