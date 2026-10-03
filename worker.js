const CATALOGS = [
  {
    name: "Arabia",
    url: "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=Arabia"
  },
  {
    name: "France",
    url: "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=France"
  }
];

const RESOLVE_URL = "https://kool.ws/live/resolve";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

function response(body, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(body, {
    status,
    headers: {
      ...CORS,
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    }
  });
}

async function getCatalog(catalog) {
  const r = await fetch(catalog.url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!r.ok) {
    throw new Error(`${catalog.name}: HTTP ${r.status}`);
  }

  return await r.json();
}

function findChannels(data, group, output = []) {
  if (!data) return output;

  if (Array.isArray(data)) {
    for (const item of data) {
      findChannels(item, group, output);
    }
    return output;
  }

  if (typeof data !== "object") return output;

  const playUrl =
    data.url ||
    data.play_url ||
    data.playUrl ||
    data.link ||
    "";

  if (
    typeof playUrl === "string" &&
    /\/live\/play\//.test(playUrl)
  ) {
    output.push({
      name:
        data.name ||
        data.title ||
        data.channel_name ||
        data.channelName ||
        "Unknown",

      url: playUrl,

      logo:
        data.logo ||
        data.logo_url ||
        data.logoUrl ||
        data.icon ||
        "",

      group
    });

    return output;
  }

  for (const value of Object.values(data)) {
    if (value && typeof value === "object") {
      findChannels(value, group, output);
    }
  }

  return output;
}

async function getChannels() {
  const all = [];

  for (const catalog of CATALOGS) {
    try {
      const data = await getCatalog(catalog);

      const channels = findChannels(
        data,
        catalog.name
      );

      all.push(...channels);
    } catch (e) {
      console.log(
        `Erreur ${catalog.name}: ${e.message}`
      );
    }
  }

  // Supprimer les doublons
  const seen = new Set();

  return all.filter(channel => {
    if (!channel.url) return false;

    if (seen.has(channel.url)) {
      return false;
    }

    seen.add(channel.url);
    return true;
  });
}

function clean(value) {
  return String(value || "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/"/g, "'");
}

async function createPlaylist(request) {
  const channels = await getChannels();

  const origin = new URL(request.url).origin;

  let m3u = "#EXTM3U\n";
  m3u += "#PLAYLIST:Arabia + France\n";

  for (const channel of channels) {
    const name = clean(channel.name);
    const group = clean(channel.group);

    const logo = channel.logo
      ? clean(channel.logo)
      : "";

    const stream =
      origin +
      "/stream?url=" +
      encodeURIComponent(channel.url);

    m3u +=
      `#EXTINF:-1 tvg-name="${name}" ` +
      `tvg-logo="${logo}" ` +
      `group-title="${group}",${name}\n`;

    m3u += stream + "\n";
  }

  return m3u;
}

async function resolve(url) {
  const endpoint =
    RESOLVE_URL +
    "?region=FR" +
    "&language=fr" +
    "&url=" +
    encodeURIComponent(url);

  const r = await fetch(endpoint, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!r.ok) {
    throw new Error(`Resolve HTTP ${r.status}`);
  }

  const data = await r.json();

  // Différents formats possibles de réponse
  return (
    data.url ||
    data.stream ||
    data.stream_url ||
    data.playlist ||
    data.hls ||
    null
  );
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // OPTIONS / CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    // Accueil
    if (url.pathname === "/") {
      return response(
        JSON.stringify({
          status: "online",
          service: "ZACTV",
          endpoints: [
            "/health",
            "/channels.json",
            "/playlist.m3u"
          ]
        }, null, 2),
        200,
        "application/json; charset=utf-8"
      );
    }

    // Test
    if (url.pathname === "/health") {
      return response(
        JSON.stringify({
          status: "ok"
        }),
        200,
        "application/json"
      );
    }

    // Liste des chaînes
    if (url.pathname === "/channels.json") {
      try {
        const channels = await getChannels();

        return response(
          JSON.stringify(channels, null, 2),
          200,
          "application/json; charset=utf-8"
        );
      } catch (e) {
        return response(
          JSON.stringify({
            error: e.message
          }),
          500,
          "application/json"
        );
      }
    }

    // Playlist M3U
    if (url.pathname === "/playlist.m3u") {
      try {
        const playlist = await createPlaylist(request);

        return response(
          playlist,
          200,
          "application/vnd.apple.mpegurl; charset=utf-8"
        );
      } catch (e) {
        return response(
          "#EXTM3U\n# ERROR\n",
          500,
          "application/vnd.apple.mpegurl"
        );
      }
    }

    // Résolution d'une chaîne
    if (url.pathname === "/stream") {
      const playUrl = url.searchParams.get("url");

      if (!playUrl) {
        return response(
          JSON.stringify({
            error: "url manquante"
          }),
          400,
          "application/json"
        );
      }

      // Limiter aux URLs de lecture du catalogue
      if (
        !playUrl.startsWith(
          "https://kool.ws/live/play/"
        ) &&
        !playUrl.startsWith(
          "http://kool.ws/live/play/"
        )
      ) {
        return response(
          JSON.stringify({
            error: "URL non autorisée"
          }),
          400,
          "application/json"
        );
      }

      try {
        const streamUrl = await resolve(playUrl);

        if (!streamUrl) {
          throw new Error(
            "Aucune URL de flux retournée"
          );
        }

        return Response.redirect(streamUrl, 302);

      } catch (e) {
        return response(
          JSON.stringify({
            error: "Résolution impossible",
            details: e.message
          }),
          502,
          "application/json"
        );
      }
    }

    return response(
      JSON.stringify({
        error: "Not found"
      }),
      404,
      "application/json"
    );
  }
};
