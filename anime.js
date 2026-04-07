// netlify/functions/anime.js
// Runs SERVER-SIDE on Netlify — no CORS restrictions at all.
// The browser calls /api/anime?action=...&source=... and this
// function fetches from HiAnime / GogoAnime on the server.

const HIANIME_V2 = [
  "https://aniwatch-api-net.vercel.app",
  "https://aniwatch-api-gamma.vercel.app",
  "https://aniwatch-api-rosy-one.vercel.app",
  "https://anianime.vercel.app",
  "https://aniwatch99.vercel.app",
];

const HIANIME_ROUGE = [
  "https://api-anime-rouge.vercel.app",
];

const GOGO = [
  "https://consumet-api.onrender.com",
  "https://consumet.pp.ua",
  "https://consumet-vercel-ten.vercel.app",
  "https://consumet.animeapi.my",
];

async function tryAll(urls, timeout = 9000) {
  for (const url of urls) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const r     = await fetch(url, {
        signal:  ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Watchime/1.0)" },
      });
      clearTimeout(timer);
      if (r.ok) return await r.json();
    } catch { /* try next */ }
  }
  throw new Error("all upstream sources failed");
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":"Content-Type",
    "Cache-Control":               "s-maxage=120",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const p        = event.queryStringParameters || {};
  const action   = p.action   || "";
  const id       = p.id       || "";
  const title    = p.title    || "";
  const category = p.category || "sub";
  const source   = p.source   || "hianime";
  const q        = encodeURIComponent(title);

  try {
    let data;

    // ── SEARCH ────────────────────────────────────────────
    if (action === "search") {
      if (source === "hianime") {
        data = await tryAll([
          ...HIANIME_V2.map(h    => `${h}/api/v2/hianime/search?q=${q}&page=1`),
          ...HIANIME_ROUGE.map(h => `${h}/aniwatch/search?keyword=${q}`),
        ]);
      } else {
        data = await tryAll(GOGO.map(h => `${h}/anime/gogoanime/${q}`));
      }

    // ── EPISODES ──────────────────────────────────────────
    } else if (action === "episodes") {
      if (source === "hianime") {
        data = await tryAll([
          ...HIANIME_V2.map(h    => `${h}/api/v2/hianime/anime/${id}/episodes`),
          ...HIANIME_ROUGE.map(h => `${h}/aniwatch/episodes/${id}`),
        ]);
      } else {
        data = await tryAll(GOGO.map(h => `${h}/anime/gogoanime/info/${encodeURIComponent(id)}`));
      }

    // ── STREAM ────────────────────────────────────────────
    } else if (action === "stream") {
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
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
