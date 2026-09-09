/**
 * Daily build trigger for glasgowtheatre.com.
 *
 * Cloudflare Pages has no scheduled builds of its own, so this Worker runs on
 * a cron trigger and POSTs to the project's deploy hook. The Pages build then
 * does the real work: refresh listings, tag them, build, and email the report.
 *
 * DEPLOY_HOOK is a secret:
 *   npx wrangler secret put DEPLOY_HOOK
 *
 * Visiting the Worker's URL shows when it last ran, which is the quickest way
 * to tell whether the schedule is alive without opening the dashboard.
 */

async function trigger(env) {
  if (!env.DEPLOY_HOOK) throw new Error("DEPLOY_HOOK secret is not set");
  const res = await fetch(env.DEPLOY_HOOK, { method: "POST" });
  const body = await res.text();
  if (!res.ok) throw new Error(`Deploy hook returned ${res.status}: ${body}`);
  return body;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          await trigger(env);
          console.log(`Triggered build at ${new Date(event.scheduledTime).toISOString()}`);
        } catch (err) {
          // Logged to `wrangler tail` and the Workers dashboard.
          console.error(`Failed to trigger build: ${err.message}`);
          throw err;
        }
      })(),
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // Manual run, for testing the wiring without waiting for the cron.
    if (url.pathname === "/trigger" && request.method === "POST") {
      if (url.searchParams.get("key") !== env.TRIGGER_KEY) {
        return new Response("Forbidden\n", { status: 403 });
      }
      try {
        await trigger(env);
        return new Response("Build triggered\n");
      } catch (err) {
        return new Response(`${err.message}\n`, { status: 502 });
      }
    }

    return new Response(
      "glasgowtheatre.com build trigger.\n" +
        "Runs daily at 05:17 UTC and POSTs the Pages deploy hook.\n",
      { headers: { "Content-Type": "text/plain" } },
    );
  },
};
