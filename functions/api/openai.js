// functions/api/openai.js

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...headers }
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET /api/openai -> health check
// GET /api/openai?selftest=1 -> tiny live test against OpenAI (returns status + first 200 chars)
export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);

    if (url.searchParams.get("selftest") === "1") {
      if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY not set" }, 500);

      const payload = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5
      };

      const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const text = await upstream.text();
      return json({
        ok: upstream.ok,
        status: upstream.status,
        contentType: upstream.headers.get("content-type") || null,
        bodyPreview: text.slice(0, 200) // short preview to avoid huge logs
      }, upstream.ok ? 200 : 502);
    }

    return new Response("ok", { status: 200, headers: CORS });
  } catch (err) {
    console.error("GET error:", err);
    return json({ error: String(err?.message || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.OPENAI_API_KEY) {
      return json({ error: "OPENAI_API_KEY not set" }, 500);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (!payload?.model || !payload?.messages) {
      return json({ error: "Missing required fields: model, messages" }, 400);
    }

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await upstream.text();
    const isJSON = upstream.headers.get("content-type")?.includes("application/json");

    // Pass through upstream status + body verbatim so you can see 401/429/etc.
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...(isJSON ? { "Content-Type": "application/json" }
                  : { "Content-Type": "text/plain; charset=utf-8" }),
        ...CORS
      }
    });
  } catch (err) {
    console.error("POST error:", err);
    return json({ error: String(err?.message || err) }, 500);
  }
}
