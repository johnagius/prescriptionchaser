/**
 * Prescription Chaser — Cloudflare Worker.
 *
 * Serves the single-page app from ./public as a static asset. All file
 * processing happens client-side in the browser; this Worker never receives,
 * stores or sees any client data — it only delivers the HTML/JS.
 */
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    // SPA fallback: any unknown path serves the app shell.
    if (res.status === 404) {
      return env.ASSETS.fetch(new URL("/index.html", request.url));
    }
    return res;
  },
};
