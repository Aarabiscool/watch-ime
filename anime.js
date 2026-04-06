// netlify/functions/anime.js
// This runs SERVER-SIDE on Netlify — no CORS issues, no browser restrictions.
// The frontend calls /api/anime?action=...&source=... and this proxies
// the request to whichever streaming API works.
//
// Node 18+ has fetch built-in so no npm install needed.

// ── HiAnime API mirrors ────────────────────────────────────
// v2 format: /api/v2/hianime/...
const HIANIME_V2 = [
  "https://aniwatch-api-net.vercel.app",
  "https://aniwatch-api-gamma.vercel.app",
  "https://aniwatch-api-rosy-one.vercel.app",
  "https://anianime.vercel.app",
  "https://aniwatch99.vercel.app",
];

// rouge format: /aniwatch/...  (different URL schema, same data)
const HIANIME_ROUGE = [
  "https://api-anime-rouge.vercel.app",
];

// ── GogoAnime via Consumet mirrors ─────────────────────────
const GOGO = [
  "https://consumet-api.onrender.com",
  "https://consumet.pp.ua",
  "https://consumet-vercel-ten.vercel.app",
  "https://consumet.animeapi.my",
];

// ── Try a list of URLs, return first success ───────────────
async function tryAll(urls, timeout = 9000) {
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), timeout);
      const r = await fetch(url, {
        signal:  controller.signal,
        headers: { "User-Agent": "Watchime/1.0" },
      });
      clearTimeout(timer);
      if (r.ok) return await r.json();
    } catch { /* try next */ }
  }
  throw new Error("all upstream sources failed");
}

// ── Main handler ───────────────────────────────────────────
exports.handler = async (event) => {
  // CORS headers — allow our Netlify frontend to call this function
  const headers = {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":"Content-Type",
    "Cache-Control":               "s-maxage=60",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const p        = event.queryStringParameters || {};
  const action   = p.action   || "";
  const id       = p.id       || "";
  const title    = p.title    || "";
  const category = p.category || "sub";   // "sub" | "dub"
  const source   = p.source   || "hianime";
  const q        = encodeURIComponent(title);

  try {
    let data;

    // ── SEARCH ─────────────────────────────────────────────
    if (action === "search") {
      if (source === "hianime") {
        data = await tryAll([
          ...HIANIME_V2.map(h    => `${h}/api/v2/hianime/search?q=${q}&page=1`),
          ...HIANIME_ROUGE.map(h => `${h}/aniwatch/search?keyword=${q}`),
        ]);
      } else {
        data = await tryAll(GOGO.map(h => `${h}/anime/gogoanime/${q}`));
      }

    // ── EPISODES ────────────────────────────────────────────
    } else if (action === "episodes") {
      // id = hianime slug (e.g. "jujutsu-kaisen-2nd-season-18413")
      if (source === "hianime") {
        data = await tryAll([
          ...HIANIME_V2.map(h    => `${h}/api/v2/hianime/anime/${id}/episodes`),
          ...HIANIME_ROUGE.map(h => `${h}/aniwatch/episodes/${id}`),
        ]);
      } else {
        // id = consumet anime id (e.g. "jujutsu-kaisen-dub")
        data = await tryAll(GOGO.map(h => `${h}/anime/gogoanime/info/${encodeURIComponent(id)}`));
      }

    // ── STREAM ──────────────────────────────────────────────
    } else if (action === "stream") {
      // id = episode id (e.g. "jujutsu-kaisen-2nd-season-18413?ep=123456")
      if (source === "hianime") {
        data = await tryAll([
          ...HIANIME_V2.map(h    => `${h}/api/v2/hianime/episode/sources?animeEpisodeId=${encodeURIComponent(id)}&server=vidstreaming&category=${category}`),
          ...HIANIME_ROUGE.map(h => `${h}/aniwatch/episode-srcs?id=${encodeURIComponent(id)}&server=vidstreaming&category=${category}`),
        ]);
      } else {
        data = await tryAll(GOGO.map(h => `${h}/anime/gogoanime/watch/${encodeURIComponent(id)}`));
      }

    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "unknown action" }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message }) };
  }
};
