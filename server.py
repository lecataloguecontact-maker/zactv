import os
import urllib.parse
import requests
from flask import Flask, Response, abort, redirect, request

app = Flask(__name__)

CATALOGS = {
    "Arabia": "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=Arabia",
    "France": "https://kool.ws/live/catalog/live/channels.json?region=FR&language=fr&sort=trending&filter%5Bgroup%5D=France",
}

RESOLVE_URL = "https://kool.ws/live/resolve"
REGION = "FR"
LANGUAGE = "fr"
TIMEOUT = 20


def extract_channels(data):
    if isinstance(data, list):
        return data

    if isinstance(data, dict):
        for key in ("channels", "items", "data"):
            value = data.get(key)
            if isinstance(value, list):
                return value

    return []


def get_catalog():
    result = []
    seen = set()

    for group, catalog_url in CATALOGS.items():
        response = requests.get(
            catalog_url,
            timeout=TIMEOUT,
            headers={"User-Agent": "KOOL-M3U-Server/1.0"},
        )
        response.raise_for_status()

        for channel in extract_channels(response.json()):
            name = str(channel.get("name", "")).strip()
            play_url = channel.get("url")

            if not name or not play_url:
                continue

            # Deduplicate channels appearing in both catalogs.
            if play_url in seen:
                continue

            seen.add(play_url)

            result.append(
                {
                    "name": name,
                    "play_url": play_url,
                    "group": group,
                    "logo": channel.get("logo")
                    or channel.get("icon")
                    or "",
                }
            )

    return result


def resolve_stream(play_url):
    response = requests.get(
        RESOLVE_URL,
        params={
            "region": REGION,
            "language": LANGUAGE,
            "url": play_url,
        },
        timeout=TIMEOUT,
        headers={"User-Agent": "KOOL-M3U-Server/1.0"},
    )
    response.raise_for_status()

    data = response.json()
    stream_url = data.get("url")

    if not stream_url:
        raise RuntimeError("Resolver did not return a stream URL")

    return stream_url


@app.get("/")
def index():
    return {
        "status": "ok",
        "playlist": "/playlist.m3u",
        "channels": "/channels.json",
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/channels.json")
def channels_json():
    try:
        return get_catalog()
    except Exception as exc:
        return {"error": str(exc)}, 502


@app.get("/playlist.m3u")
def playlist():
    try:
        channels = get_catalog()
    except Exception:
        # Return a valid but empty playlist instead of exposing an exception.
        response = Response(
            "#EXTM3U\n",
            mimetype="audio/x-mpegurl",
        )
        response.headers["Cache-Control"] = "no-store"
        return response, 502

    base_url = request.host_url.rstrip("/")
    lines = ["#EXTM3U"]

    for channel in channels:
        encoded_play_url = urllib.parse.quote(
            channel["play_url"],
            safe="",
        )

        name = channel["name"].replace("\r", " ").replace("\n", " ")
        group = channel["group"].replace("\r", " ").replace("\n", " ")
        logo = channel["logo"].replace('"', "%22")

        lines.append(
            f'#EXTINF:-1 tvg-name="{name}" '
            f'tvg-logo="{logo}" group-title="{group}",{name}'
        )
        lines.append(
            f"{base_url}/stream/{encoded_play_url}"
        )

    response = Response(
        "\n".join(lines) + "\n",
        mimetype="audio/x-mpegurl",
    )
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@app.get("/stream/<path:encoded_url>")
def stream(encoded_url):
    try:
        play_url = urllib.parse.unquote(encoded_url)

        if not play_url.startswith(("http://", "https://")):
            abort(400)

        stream_url = resolve_stream(play_url)

        # The temporary upstream URL is returned only for this request.
        return redirect(stream_url, code=302)

    except requests.RequestException:
        abort(502)
    except Exception:
        abort(502)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
