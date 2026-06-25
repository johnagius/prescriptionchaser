/**
 * Prescription Chaser — Cloudflare Worker.
 *
 * - Serves the single-page app from ./public as static assets.
 * - Exposes /api/overrides, a tiny cloud store for the user's email corrections
 *   (customer-number -> replacement email), backed by Workers KV.
 *
 * Patient file processing stays entirely in the browser. The ONLY data this
 * Worker persists is the email overrides the user explicitly chooses to save —
 * stored under a single KV key so they sync across the user's devices.
 */
const KV_KEY = "overrides";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/overrides") {
      // KV not bound (e.g. namespace couldn't be provisioned) → behave as empty
      // so the front-end transparently falls back to local-only storage.
      if (!env.OVERRIDES) return json({ overrides: {}, cloud: false });

      if (request.method === "GET") {
        const raw = await env.OVERRIDES.get(KV_KEY);
        return json({ overrides: raw ? JSON.parse(raw) : {}, cloud: true });
      }

      if (request.method === "PUT" || request.method === "POST") {
        // The client owns the full overrides object ({rename, cc, assign}) and
        // PUTs the whole blob on each change (single-user tool).
        let body;
        try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
        const clean = {
          rename: (body && body.rename) || {},
          cc: (body && body.cc) || {},
          assign: (body && body.assign) || {},
        };
        await env.OVERRIDES.put(KV_KEY, JSON.stringify(clean));
        return json({ overrides: clean, cloud: true });
      }

      return json({ error: "method not allowed" }, 405);
    }

    // Static assets (SPA fallback to index.html on 404).
    const res = await env.ASSETS.fetch(request);
    if (res.status === 404) return env.ASSETS.fetch(new URL("/index.html", request.url));
    return res;
  },
};
