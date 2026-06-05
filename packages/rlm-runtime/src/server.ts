const modelServiceUrl =
  Deno.env.get("MODEL_SERVICE_URL") || "http://model-service:8100";

Deno.serve({ port: 8787 }, async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return Response.json({
      status: "ok",
      service: "rlm-runtime",
    });
  }

  if (url.pathname === "/execute" && req.method === "POST") {
    const body = await req.json();

    const modelResp = await fetch(`${modelServiceUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "reasoning",
        messages: [
          {
            role: "system",
            content:
              "You are RLM Forge. Return a concise JSON research plan. Do not write markdown.",
          },
          {
            role: "user",
            content: body.query || "",
          },
        ],
      }),
    });

    const modelResult = await modelResp.json();

    return Response.json({
      status: "ok",
      input: body,
      modelResult,
    });
  }

  return Response.json({ error: "not found" }, { status: 404 });
});
