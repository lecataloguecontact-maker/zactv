# KOOL M3U Server

Dynamic M3U playlist for the Arabia and France catalogs.

## Endpoints

- `/playlist.m3u` - M3U playlist
- `/channels.json` - merged channel list
- `/health` - health check

The playlist does not store temporary HLS tokens. When a player requests
`/stream/...`, the server calls the configured resolver and redirects the
player to the returned stream URL.

## Local

```bash
pip install -r requirements.txt
python server.py
```

Then open:

`http://127.0.0.1:10000/playlist.m3u`

## Render

This repository includes `render.yaml`.

Create a Render Web Service from this GitHub repository. Render can use the
Blueprint configuration in `render.yaml`, or configure:

Build command:
`pip install -r requirements.txt`

Start command:
`gunicorn --bind 0.0.0.0:$PORT server:app`

After deployment:

`https://YOUR-SERVICE.onrender.com/playlist.m3u`

Use only streams you are authorized to access and redistribute.
