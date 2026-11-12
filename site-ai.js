const origin = "https://wsr666914.github.io";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Cache-Control": "no-store",
};

function reply(status, body) {
  return Response.json(body, { status, headers: cors });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "请求方式不支持。" });

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply(401, { error: "请先登录云端账号。" });
  const project = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("AI_API_KEY");
  const model = Deno.env.get("AI_MODEL") || "glm-4.7-flash";
  if (!project || !serviceKey || !apiKey) return reply(503, { error: "网站 AI 暂未启用。" });

  try {
    const auth = await fetch(project + "/auth/v1/user", {
      headers: { apikey: serviceKey, Authorization: authorization },
      signal: AbortSignal.timeout(8000),
    });
    if (!auth.ok) return reply(auth.status < 500 ? 401 : 503, { error: auth.status < 500 ? "云端登录已失效，请重新登录。" : "登录验证暂不可用。" });
    const user = await auth.json();
    if (!user.id || user.role !== "authenticated" || user.is_anonymous) return reply(403, { error: "请使用云端账号登录。" });

    const raw = await req.text();
    if (raw.length > 40000) return reply(413, { error: "内容太长，请缩短后重试。" });
    const body = JSON.parse(raw);
    const messages = body?.messages;
    if (!Array.isArray(messages) || !messages.length || messages.length > 12 ||
        !messages.every((m) => m && ["system", "user", "assistant"].includes(m.role) && typeof m.content === "string") ||
        !messages.some((m) => m.role === "user") ||
        messages.reduce((sum, m) => sum + m.content.length, 0) > 24000) {
      return reply(400, { error: "内容太长或格式有误，请缩短后重试。" });
    }
    const quota = await fetch(project + "/rest/v1/rpc/site_ai_reserve", {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_user: user.id }),
      signal: AbortSignal.timeout(8000),
    });
    if (!quota.ok) return reply(503, { error: "AI 额度暂时无法确认。" });
    if ((await quota.json()) !== true) return reply(429, { error: "今日 AI 使用额度已用完，请明天再试。" });

    const upstream = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: messages.map(({ role, content }) => ({ role, content })),
        max_tokens: Number.isInteger(body.max_tokens) ? Math.max(128, Math.min(5000, body.max_tokens)) : 2000,
        temperature: typeof body.temperature === "number" ? Math.max(0, Math.min(1, body.temperature)) : 0.6,
        thinking: { type: "disabled" },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (upstream.status === 429) {
      const details = await upstream.json().catch(() => null);
      const code = String(details?.error?.code || "");
      return reply(429, {
        error: "模型服务当前繁忙或额度已用完，请稍后再试。",
        code: /^[0-9]{3,6}$/.test(code) ? code : undefined,
      });
    }
    if (!upstream.ok) return reply(502, { error: "模型服务暂不可用，请稍后重试。" });
    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim()
      ? reply(200, { content, model })
      : reply(502, { error: "模型未返回可用内容。" });
  } catch (error) {
    if (error instanceof SyntaxError) return reply(400, { error: "请求格式有误。" });
    return reply(503, { error: "AI 连接暂时不可用，请稍后再试。" });
  }
});
