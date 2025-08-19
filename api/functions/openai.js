// functions/api/openai.js

const CORS = {
  "Access-Control-Allow-Origin": "*",               // tighten to your domain if you want
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);

    // Health check & simple GET
    if (method === "GET") {
      return new Response("ok", { status: 200, headers: CORS });
    }

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // POST → proxy to OpenAI
    if (method === "POST") {
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

      return new Response(text, {
        status: upstream.status,
        headers: {
          ...(isJSON ? { "Content-Type": "application/json" }
                    : { "Content-Type": "text/plain; charset=utf-8" }),
          ...CORS
        }
      });
    }

    // Anything else
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
