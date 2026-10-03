const CATALOGS = [
  {
    group: "Arabia",
    url: "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=Arabia",
  },
  {
    group: "France",
    url: "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=France",
  },
  {
    group: "United Kingdom",
    url: "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=United%20Kingdom",
  },
  {
    group: "Spain",
    url: "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=Spain",
  },
  {
    group: "Poland",
    url: "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=Poland",
  },
  {
    group: "Portugal",
    url: "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=Portugal",
  },
  {
    group: "Croatia",
    url: "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=Croatia",
  },
];

const RESOLVE_URL = "https://kool.ws/live/resolve";
const PLAY_PREFIX = "https://kool.ws/live/play/";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/") {
        return new Response(
          "ZACTV Worker OK\n\n/playlist.m3u\n/channels.json\n/health",
          {
            headers: {
              ...CORS,
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }

      if (url.pathname === "/health") {
        return jsonResponse({
          ok: true,
          catalogs: CATALOGS.map(c => c.group),
          time: new Date().toISOString(),
        });
      }

      if (url.pathname === "/channels.json") {
        const channels = await getChannels();

        return jsonResponse({
          updated: new Date().toISOString(),
          count: channels.length,
          channels,
        });
      }

      if (url.pathname === "/playlist.m3u") {
        const channels = await getChannels();

        return new Response(buildM3U(channels), {
          headers: {
            ...CORS,
            "Content-Type": "audio/x-mpegurl; charset=utf-8",
            "Content-Disposition": 'inline; filename="zactv.m3u"',
          },
        });
      }

      if (url.pathname === "/stream") {
        const source = url.searchParams.get("url");

        if (!source) {
          return new Response("Missing ?url=", {
            status: 400,
            headers: CORS,
          });
        }

        if (!isAllowedPlayUrl(source)) {
          return new Response("Invalid stream URL", {
            status: 403,
            headers: CORS,
          });
        }

        const resolved = await resolveStream(source);

        if (!resolved) {
          return new Response("Unable to resolve stream", {
            status: 502,
            headers: CORS,
          });
        }

        return Response.redirect(resolved, 302);
      }

      return new Response("Not found", {
        status: 404,
        headers: CORS,
      });

    } catch (error) {
      return jsonResponse(
        {
          error: true,
          message:
            error instanceof Error
              ? error.message
              : String(error),
        },
        500
      );
    }
  },
};

async function getChannels() {
  const results = await Promise.allSettled(
    CATALOGS.map(async catalog => {
      const response = await fetch(catalog.url, {
        headers: {
          "User-Agent": "ZACTV-Worker/1.0",
          "Accept": "application/json",
        },
        cf: {
          cacheTtl: 0,
          cacheEverything: false,
        },
      });

      if (!response.ok) {
        throw new Error(
          `${catalog.group}: HTTP ${response.status}`
        );
      }

      const data = await response.json();

      const channels = extractChannels(data);

      return channels.map(channel =>
        normalizeChannel(channel, catalog.group)
      );
    })
  );

  const all = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      all.push(...result.value);
    }
  }

  return dedupeChannels(all);
}

function extractChannels(value, depth = 0) {
  if (depth > 8 || value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    const direct = value.filter(isChannelObject);

    if (direct.length) {
      return direct;
    }

    let found = [];

    for (const item of value) {
      found.push(
        ...extractChannels(item, depth + 1)
      );
    }

    return found;
  }

  if (typeof value !== "object") {
    return [];
  }

  for (const key of [
    "channels",
    "items",
    "results",
    "data",
    "entries",
    "content",
  ]) {
    if (key in value) {
      const found = extractChannels(
        value[key],
        depth + 1
      );

      if (found.length) {
        return found;
      }
    }
  }

  let found = [];

  for (const [key, child] of Object.entries(value)) {
    if (
      key !== "metadata" &&
      key !== "meta" &&
      key !== "pagination"
    ) {
      found.push(
        ...extractChannels(child, depth + 1)
      );
    }
  }

  return found;
}

function isChannelObject(obj) {
  if (
    !obj ||
    typeof obj !== "object" ||
    Array.isArray(obj)
  ) {
    return false;
  }

  const name =
    obj.name ??
    obj.title ??
    obj.channel_name ??
    obj.displayName ??
    obj.label;

  const id =
    obj.id ??
    obj.channel_id ??
    obj.channelId;

  const play =
    obj.url ??
    obj.play_url ??
    obj.playUrl ??
    obj.stream_url ??
    obj.streamUrl ??
    obj.href;

  return Boolean(name && (id || play));
}

function normalizeChannel(channel, group) {
  const name =
    channel.name ??
    channel.title ??
    channel.channel_name ??
    channel.displayName ??
    channel.label ??
    "Unknown";

  const id =
    channel.id ??
    channel.channel_id ??
    channel.channelId ??
    "";

  const source =
    channel.url ??
    channel.play_url ??
    channel.playUrl ??
    channel.stream_url ??
    channel.streamUrl ??
    channel.href ??
    "";

  let playUrl = source;

  if (id && !isAllowedPlayUrl(playUrl)) {
    playUrl =
      `${PLAY_PREFIX}${encodeURIComponent(id)}`;
  }

  return {
    id: String(id || source || name),
    name: String(name),

    group: String(
      channel.group ??
      channel.category ??
      channel.country ??
      group
    ),

    logo: String(
      channel.logo ??
      channel.logo_url ??
      channel.logoUrl ??
      channel.icon ??
      ""
    ),

    url: playUrl,
  };
}

function dedupeChannels(channels) {
  const seen = new Set();
  const output = [];

  for (const channel of channels) {
    if (!channel.url) {
      continue;
    }

    const key =
      `${channel.name.toLowerCase()}|${channel.url}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(channel);
  }

  return output;
}

function buildM3U(channels) {
  const lines = [
    "#EXTM3U",
    "#PLAYLIST:ZACTV Arabia + France + UK + Spain + Poland + Portugal + Croatia",
  ];

  for (const channel of channels) {
    if (!isAllowedPlayUrl(channel.url)) {
      continue;
    }

    const logo = channel.logo
      ? ` tvg-logo="${escapeM3U(channel.logo)}"`
      : "";

    const group =
      escapeM3U(channel.group || "Live");

    lines.push(
      `#EXTINF:-1${logo} group-title="${group}",${escapeM3U(channel.name)}`
    );

    lines.push(
      `/stream?url=${encodeURIComponent(channel.url)}`
    );
  }

  return lines.join("\n") + "\n";
}

async function resolveStream(playUrl) {
  const resolve = new URL(RESOLVE_URL);

  resolve.searchParams.set("region", "FR");
  resolve.searchParams.set("language", "fr");
  resolve.searchParams.set("url", playUrl);

  const response = await fetch(
    resolve.toString(),
    {
      headers: {
        "User-Agent": "ZACTV-Worker/1.0",
        "Accept": "application/json",
        "Referer": "https://kool.ws/",
        "Origin": "https://kool.ws",
      },

      cf: {
        cacheTtl: 0,
        cacheEverything: false,
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    contentType.includes("application/json")
  ) {
    const data = await response.json();

    const resolved =
      data.url ??
      data.stream_url ??
      data.streamUrl ??
      data.src ??
      data.source ??
      data.data?.url ??
      data.data?.stream_url;

    if (
      typeof resolved === "string" &&
      resolved.startsWith("http")
    ) {
      return resolved;
    }

    return null;
  }

  const text = await response.text();

  const match =
    text.match(/https?:\/\/[^\s"'<>]+/);

  return match ? match[0] : null;
}

function isAllowedPlayUrl(value) {
  try {
    const u = new URL(value);

    return (
      u.protocol === "https:" &&
      u.hostname === "kool.ws" &&
      u.pathname.startsWith("/live/play/")
    );
  } catch {
    return false;
  }
}

function escapeM3U(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, " ");
}

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        ...CORS,
        "Content-Type":
          "application/json; charset=utf-8",
      },
    }
  );
}
