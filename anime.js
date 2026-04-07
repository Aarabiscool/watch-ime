// netlify/functions/anime.js
// Runs SERVER-SIDE on Netlify — no CORS restrictions.
// Proxies to 5 streaming sources, trying multiple mirrors per source.

// ── Source 1: HiAnime (aniwatch-api forks) ────────────────
const HIANIME_V2 = [
  "https://aniwatch-api-net.vercel.app",
  "https://aniwatch-api-gamma.vercel.app",
  "https://aniwatch-api-rosy-one.vercel.app",
  "https://anianime.vercel.app",
  "https://aniwatch99.vercel.app",
];
const HIANIME_ROUGE = [
  "https://api-anime-rouge.vercel.app",
  "https://aninescraper.vercel.app",
];

// ── Source 2: GogoAnime (Consumet mirrors) ─────────────────
const GOGO = [
  "https://consumet-api.onrender.com",
  "https://consumet.pp.ua",
  "https://consumet-vercel-ten.vercel.app",
  "https://consumet.animeapi.my",
];

// ── Source 3: Kaido (itzzzme/anime-api — another HiAnime scraper) ──
// Docs: github.com/itzzzme/anime-api
// Search:   /api/search?keyword={q}          → results[].id
// Episodes: /api/episodes/{animeId}           → results.episodes[].id  (format: "slug?ep=NUMBER")
// Stream:   /api/stream?id={epId}&server=hd-1&type=sub|dub
//           → results.streamingLink[0].link.file  (m3u8)
const KAIDO = [
  "https://anime-api-eight-red.vercel.app",
  "https://zenime-api.vercel.app",
];

// ── Source 4: AllAnime (GraphQL at api.allanime.day) ───────
// Used by ani-cli. GraphQL POST endpoint, returns sourceUrls with m3u8
const ALLANIME_API  = "https://api.allanime.day/api";
const ALLANIME_REFERER = "https://allanime.to";

// ── Source 5: AnimeKai (api-anime-rouge rouge format) ──────
// api-anime-rouge mirrors also have a /gogoanime/ route
const ANIMEKAI = [
  "https://api-anime-rouge.vercel.app",
  "https://aninescraper.vercel.app",
];

// ── Generic HTTP helper ────────────────────────────────────
async function get(url, opts = {}, timeout = 9000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Watchime/1.0)",
        ...(opts.headers || {}),
      },
      ...opts,
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function tryAll(urls, opts, timeout) {
  for (const url of urls) {
    try { return await get(url, opts, timeout); } catch { /* next */ }
  }
  throw new Error("all mirrors offline");
}

// ── AllAnime GraphQL helper ────────────────────────────────
async function allAnimeGQL(query, variables) {
  const body = JSON.stringify({ query, variables });
  const r = await fetch(ALLANIME_API, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Referer":       ALLANIME_REFERER,
      "User-Agent":    "Mozilla/5.0 (compatible; Watchime/1.0)",
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`AllAnime HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}

// ══════════════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════════════
async function searchHiAnime(q) {
  const enc = encodeURIComponent(q);
  const d = await tryAll([
    ...HIANIME_V2.map(h    => `${h}/api/v2/hianime/search?q=${enc}&page=1`),
    ...HIANIME_ROUGE.map(h => `${h}/aniwatch/search?keyword=${enc}`),
  ]);
  return (d?.data?.animes || d?.animes || d?.results || [])
    .map(a => ({ id: a.id, title: a.name || a.title }));
}

async function searchGogoAnime(q) {
  const enc = encodeURIComponent(q);
  const d   = await tryAll(GOGO.map(h => `${h}/anime/gogoanime/${enc}`));
  return (d?.results || []).map(a => ({ id: a.id, title: a.title }));
}

async function searchKaido(q) {
  const enc = encodeURIComponent(q);
  const d   = await tryAll(KAIDO.map(h => `${h}/api/search?keyword=${enc}`));
  return (d?.results || []).map(a => ({ id: a.id, title: a.title || a.japanese_title }));
}

async function searchAllAnime(q) {
  const GQL = `
    query($search: SearchInput, $limit: Int, $page: Int, $translationType: VaildTranslationTypeEnumType) {
      shows(search: $search, limit: $limit, page: $page, translationType: $translationType) {
        edges {
          _id
          name
          englishName
          thumbnail
          episodeCount
        }
      }
    }`;
  const d = await allAnimeGQL(GQL, {
    search: { query: q, allowAdult: false, allowUnknown: false },
    limit: 20, page: 1, translationType: "sub",
  });
  return (d?.shows?.edges || []).map(a => ({ id: a._id, title: a.englishName || a.name }));
}

// ══════════════════════════════════════════════════════════
// EPISODES
// ══════════════════════════════════════════════════════════
async function episodesHiAnime(id) {
  const enc = encodeURIComponent(id);
  const d = await tryAll([
    ...HIANIME_V2.map(h    => `${h}/api/v2/hianime/anime/${id}/episodes`),
    ...HIANIME_ROUGE.map(h => `${h}/aniwatch/episodes/${id}`),
  ]);
  return (d?.data?.episodes || d?.episodes || [])
    .map(e => ({ number: e.number ?? e.episodeNo, id: e.episodeId ?? e.id, title: e.title }));
}

async function episodesGogoAnime(id) {
  const enc = encodeURIComponent(id);
  const d   = await tryAll(GOGO.map(h => `${h}/anime/gogoanime/info/${enc}`));
  return (d?.episodes || []).map(e => ({ number: e.number, id: e.id, title: e.title }));
}

async function episodesKaido(id) {
  const d = await tryAll(KAIDO.map(h => `${h}/api/episodes/${id}`));
  return (d?.results?.episodes || []).map(e => ({
    number: e.episode_no ?? e.number,
    id:     e.id,
    title:  e.title || e.japanese_title,
  }));
}

async function episodesAllAnime(showId) {
  const GQL = `
    query($showId: String!) {
      show(_id: $showId) {
        _id
        name
        lastEpisodeInfo
        episodeCount
        availableEpisodesDetail
      }
    }`;
  const d    = await allAnimeGQL(GQL, { showId });
  const show = d?.show;
  if (!show) throw new Error("show not found");
  const count = show.episodeCount || 0;
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1, id: String(i + 1), showId,
  }));
}

// ══════════════════════════════════════════════════════════
// STREAM
// ══════════════════════════════════════════════════════════
async function streamHiAnime(episodeId, category) {
  const enc = encodeURIComponent(episodeId);
  const d = await tryAll([
    ...HIANIME_V2.map(h    => `${h}/api/v2/hianime/episode/sources?animeEpisodeId=${enc}&server=vidstreaming&category=${category}`),
    ...HIANIME_ROUGE.map(h => `${h}/aniwatch/episode-srcs?id=${enc}&server=vidstreaming&category=${category}`),
  ]);
  const srcs = d?.data?.sources || d?.sources || [];
  const src  = srcs.find(s => s.url?.includes(".m3u8")) || srcs[0];
  if (!src?.url) throw new Error("no HiAnime stream URL");
  return { url: src.url, headers: d?.data?.headers || d?.headers || {} };
}

async function streamGogoAnime(episodeId) {
  const enc = encodeURIComponent(episodeId);
  const d   = await tryAll(GOGO.map(h => `${h}/anime/gogoanime/watch/${enc}`));
  const srcs = d?.sources || [];
  const src  = srcs.find(s => s.isM3U8 || s.url?.includes(".m3u8")) || srcs[0];
  if (!src?.url) throw new Error("no GogoAnime stream URL");
  return { url: src.url, headers: d?.headers || {} };
}

async function streamKaido(episodeId, type) {
  // episodeId format: "anime-slug?ep=NUMBER"
  const enc = encodeURIComponent(episodeId);
  const d   = await tryAll(
    KAIDO.map(h => `${h}/api/stream?id=${enc}&server=hd-1&type=${type}`)
  );
  const links = d?.results?.streamingLink || [];
  const link  = links[0]?.link;
  if (!link?.file) throw new Error("no Kaido stream URL");
  return { url: link.file, headers: {} };
}

async function streamAllAnime(showId, epNum, translationType) {
  const GQL = `
    query($showId: String!, $episodeString: String!, $translationType: VaildTranslationTypeEnumType!) {
      episode(showId: $showId, episodeString: $episodeString, translationType: $translationType) {
        episodeString
        sourceUrls
      }
    }`;
  const d   = await allAnimeGQL(GQL, {
    showId, episodeString: String(epNum), translationType,
  });
  const srcs = d?.episode?.sourceUrls || [];
  // sourceUrls contains objects like { sourceUrl, sourceName, priority }
  // The actual m3u8 is often base64-encoded or behind a redirect
  // We try to find a direct .m3u8 URL first
  const direct = srcs.find(s =>
    typeof s.sourceUrl === "string" && s.sourceUrl.includes(".m3u8")
  );
  if (direct) return { url: direct.sourceUrl, headers: {} };
  // Otherwise return the first source URL for the function to decode
  if (srcs.length) return { url: srcs[0].sourceUrl, headers: {} };
  throw new Error("no AllAnime stream URL");
}

// ══════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════
exports.handler = async (event) => {
  const CORS = {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":"Content-Type",
    "Cache-Control":               "s-maxage=60",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const p      = event.queryStringParameters || {};
  const action = p.action   || "";
  const source = p.source   || "hianime";
  const id     = p.id       || "";
  const title  = p.title    || "";
  const type   = p.type     || "sub";   // sub | dub
  const showId = p.showId   || "";      // AllAnime show _id
  const epNum  = p.epNum    || "1";

  try {
    let data;

    // ── SEARCH ──────────────────────────────────────────
    if (action === "search") {
      if      (source === "hianime")   data = await searchHiAnime(title);
      else if (source === "gogoanime") data = await searchGogoAnime(title);
      else if (source === "kaido")     data = await searchKaido(title);
      else if (source === "allanime")  data = await searchAllAnime(title);
      else throw new Error(`unknown source: ${source}`);

    // ── EPISODES ─────────────────────────────────────────
    } else if (action === "episodes") {
      if      (source === "hianime")   data = await episodesHiAnime(id);
      else if (source === "gogoanime") data = await episodesGogoAnime(id);
      else if (source === "kaido")     data = await episodesKaido(id);
      else if (source === "allanime")  data = await episodesAllAnime(id);
      else throw new Error(`unknown source: ${source}`);

    // ── STREAM ───────────────────────────────────────────
    } else if (action === "stream") {
      if      (source === "hianime")   data = await streamHiAnime(id, type);
      else if (source === "gogoanime") data = await streamGogoAnime(id);
      else if (source === "kaido")     data = await streamKaido(id, type);
      else if (source === "allanime")  data = await streamAllAnime(showId, epNum, type === "dub" ? "dub" : "sub");
      else throw new Error(`unknown source: ${source}`);

    } else {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "unknown action" }) };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };

  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
