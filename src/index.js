const CONFIG = {
  // ONLY use an HLS stream you own or are authorized to proxy.
  AUTHORIZED_HLS_URL: "https://bldcmprod-cdn.toffeelive.com/cdn/live/desh_tv/playlists.m3u8",

  USER_AGENT: "Mozilla/5.0 (compatible; HLS-Proxy/1.0)",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    try {
      if (url.pathname === "/") {
        return playerPage(request);
      }

      if (url.pathname === "/playlist.m3u8") {
        return fetchPlaylist(request);
      }

      if (url.pathname === "/proxy") {
        return proxyResource(request);
      }

      if (url.pathname === "/debug") {
        return debugInfo(request);
      }

      if (url.pathname === "/test-upstream") {
        return testUpstream();
      }

      return json(
        {
          error: "Not found",
          routes: [
            "/",
            "/playlist.m3u8",
            "/proxy?url=...",
            "/debug",
            "/test-upstream",
          ],
        },
        404
      );
    } catch (error) {
      return json(
        {
          ok: false,
          error: error?.message || String(error),
          stack: error?.stack || null,
        },
        500
      );
    }
  },
};

/* =========================================================
   PLAYLIST
========================================================= */

async function fetchPlaylist(request) {
  const started = Date.now();

  const upstreamUrl = CONFIG.AUTHORIZED_HLS_URL;

  const response = await fetch(upstreamUrl, {
    method: "GET",
    headers: {
      "User-Agent": CONFIG.USER_AGENT,
      "Accept": [
        "application/vnd.apple.mpegurl",
        "application/x-mpegURL",
        "audio/mpegurl",
        "text/plain",
        "*/*",
      ].join(", "),
    },
    redirect: "follow",
  });

  const text = await response.text();

  if (!response.ok) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          stage: "playlist-fetch",
          status: response.status,
          statusText: response.statusText,
          elapsedMs: Date.now() - started,
          bodyPreview: text.slice(0, 1000),
        },
        null,
        2
      ),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders(),
        },
      }
    );
  }

  const origin = new URL(request.url).origin;

  const rewritten = rewritePlaylistUrls(
    text,
    response.url || upstreamUrl,
    origin
  );

  return new Response(rewritten, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "X-Proxy-Time": String(Date.now() - started),
    },
  });
}

/* =========================================================
   HLS PLAYLIST REWRITER
========================================================= */

function rewritePlaylistUrls(playlist, playlistUrl, workerOrigin) {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return line;
      }

      /*
       * Comments/tags may contain URI="..."
       *
       * Example:
       * #EXT-X-MEDIA:...,URI="audio/index.m3u8"
       */
      if (trimmed.startsWith("#")) {
        return line.replace(
          /URI="([^"]+)"/gi,
          (_, uri) => {
            try {
              const absolute = new URL(uri, playlistUrl).href;

              return `URI="${workerOrigin}/proxy?url=${encodeURIComponent(
                absolute
              )}"`;
            } catch {
              return `URI="${uri}"`;
            }
          }
        );
      }

      /*
       * Normal HLS URI:
       *
       * ../slang/channel/index.m3u8
       * segment001.ts
       * /live/segment001.ts
       * https://example.com/file.ts
       *
       * new URL() correctly resolves all of them relative
       * to the CURRENT playlist URL.
       */
      try {
        const absolute = new URL(trimmed, playlistUrl).href;

        return `${workerOrigin}/proxy?url=${encodeURIComponent(
          absolute
        )}`;
      } catch {
        return line;
      }
    })
    .join("\n");
}

/* =========================================================
   RESOURCE PROXY
========================================================= */

async function proxyResource(request) {
  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");

  if (!target) {
    return json(
      {
        ok: false,
        error: "Missing ?url=",
      },
      400
    );
  }

  let targetUrl;

  try {
    targetUrl = new URL(target);
  } catch {
    return json(
      {
        ok: false,
        error: "Invalid URL",
      },
      400
    );
  }

  /*
   * Security:
   * Only allow URLs belonging to the configured authorized
   * HLS origin.
   */
  const authorizedOrigin = new URL(
    CONFIG.AUTHORIZED_HLS_URL
  ).origin;

  if (targetUrl.origin !== authorizedOrigin) {
    return json(
      {
        ok: false,
        error: "Target origin is not authorized by this worker.",
      },
      403
    );
  }

  const started = Date.now();

  const upstream = await fetch(targetUrl.href, {
    method: "GET",
    headers: {
      "User-Agent": CONFIG.USER_AGENT,
      "Accept": "*/*",
    },
    redirect: "follow",
  });

  if (!upstream.ok) {
    const preview = await upstream.text();

    return json(
      {
        ok: false,
        stage: "resource-fetch",
        status: upstream.status,
        statusText: upstream.statusText,
        target: targetUrl.href,
        elapsedMs: Date.now() - started,
        bodyPreview: preview.slice(0, 500),
      },
      502
    );
  }

  const contentType =
    upstream.headers.get("content-type") ||
    guessContentType(targetUrl.pathname);

  /*
   * If a nested playlist is returned through /proxy,
   * rewrite it too.
   */
  if (isPlaylist(contentType, targetUrl.pathname)) {
    const body = await upstream.text();

    const origin = requestUrl.origin;

    const rewritten = rewritePlaylistUrls(
      body,
      upstream.url || targetUrl.href,
      origin
    );

    return new Response(rewritten, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
        ...corsHeaders(),
      },
    });
  }

  /*
   * For TS/AAC/MP4/etc. return the upstream body directly.
   */
  const headers = new Headers();

  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-store");

  const contentLength =
    upstream.headers.get("content-length");

  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  addCors(headers);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

/* =========================================================
   DEBUG
========================================================= */

async function debugInfo(request) {
  const url = new URL(request.url);

  let upstream;

  try {
    upstream = new URL(CONFIG.AUTHORIZED_HLS_URL);
  } catch {
    return json(
      {
        ok: false,
        error: "AUTHORIZED_HLS_URL is invalid",
      },
      500
    );
  }

  return json({
    ok: true,

    worker: {
      url: url.origin,
      path: url.pathname,
      method: request.method,
      time: new Date().toISOString(),
    },

    configuration: {
      upstreamOrigin: upstream.origin,
      upstreamPath: upstream.pathname,
      userAgent: CONFIG.USER_AGENT,
    },

    endpoints: {
      player: `${url.origin}/`,
      playlist: `${url.origin}/playlist.m3u8`,
      upstreamTest: `${url.origin}/test-upstream`,
      debug: `${url.origin}/debug`,
    },
  });
}

/* =========================================================
   UPSTREAM TEST
========================================================= */

async function testUpstream() {
  const started = Date.now();

  let response;

  try {
    response = await fetch(CONFIG.AUTHORIZED_HLS_URL, {
      method: "GET",
      headers: {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept": "application/vnd.apple.mpegurl,*/*",
      },
      redirect: "follow",
    });
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "fetch",
        error: error?.message || String(error),
        elapsedMs: Date.now() - started,
      },
      502
    );
  }

  const body = await response.text();

  return json({
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    elapsedMs: Date.now() - started,

    finalUrl: response.url,

    redirected: response.redirected,

    contentType: response.headers.get("content-type"),

    contentLength: response.headers.get("content-length"),

    bodyPreview: body.slice(0, 2000),
  });
}

/* =========================================================
   PLAYER
========================================================= */

function playerPage(request) {
  const origin = new URL(request.url).origin;

  const playlist = `${origin}/playlist.m3u8`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta
  name="viewport"
  content="width=device-width,initial-scale=1,maximum-scale=1"
/>

<title>Authorized HLS Player</title>

<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(
      circle at top,
      #24324a 0,
      #101522 45%,
      #070a10 100%
    );
  color: #fff;
  font-family: Arial, sans-serif;

  display: flex;
  justify-content: center;
  align-items: center;

  padding: 20px;
}

.player {
  width: 100%;
  max-width: 900px;

  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.15);

  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);

  border-radius: 24px;
  padding: 16px;

  box-shadow:
    0 20px 60px rgba(0,0,0,.45);
}

h1 {
  font-size: 20px;
  margin: 4px 4px 14px;
}

video {
  width: 100%;
  display: block;

  background: #000;

  border-radius: 16px;

  aspect-ratio: 16 / 9;
}

.status {
  margin-top: 12px;

  padding: 12px;

  border-radius: 14px;

  background: rgba(0,0,0,.25);

  font-size: 14px;

  word-break: break-word;
}

button {
  margin-top: 12px;

  padding: 11px 16px;

  border-radius: 12px;

  border: 1px solid rgba(255,255,255,.2);

  background: rgba(255,255,255,.1);

  color: white;

  cursor: pointer;
}
</style>
</head>

<body>

<div class="player">

<h1>Authorized HLS Live Stream</h1>

<video
  id="video"
  controls
  playsinline
  preload="auto"
></video>

<div id="status" class="status">
Connecting...
</div>

<button onclick="location.href='/debug'">
Worker Debug
</button>

<button onclick="location.href='/test-upstream'">
Upstream Test
</button>

</div>

<script>
const video = document.getElementById("video");
const status = document.getElementById("status");

const playlist = ${JSON.stringify(playlist)};

function setStatus(message) {
  status.textContent = message;
  console.log(message);
}

function startPlayer() {

  setStatus("Loading HLS playlist...");

  if (window.Hls && Hls.isSupported()) {

    const hls = new Hls({
      enableWorker: true,

      lowLatencyMode: true,

      backBufferLength: 30,

      manifestLoadingMaxRetry: 3,
      levelLoadingMaxRetry: 3,
      fragLoadingMaxRetry: 3,

      xhrSetup: function(xhr) {
        xhr.withCredentials = false;
      }
    });

    hls.on(Hls.Events.MANIFEST_LOADING, function(event, data) {
      console.log("MANIFEST_LOADING", data);
    });

    hls.on(Hls.Events.MANIFEST_LOADED, function(event, data) {
      console.log("MANIFEST_LOADED", data);
    });

    hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
      console.log("MANIFEST_PARSED", data);

      setStatus(
        "Playlist loaded. Waiting for video data..."
      );

      video.play().catch(function() {
        setStatus(
          "Playlist loaded. Press Play."
        );
      });
    });

    hls.on(Hls.Events.LEVEL_LOADED, function(event, data) {
      console.log("LEVEL_LOADED", data);
    });

    hls.on(Hls.Events.FRAG_LOADING, function(event, data) {
      console.log("FRAG_LOADING", data.frag?.url);
    });

    hls.on(Hls.Events.FRAG_LOADED, function(event, data) {
      console.log("FRAG_LOADED", data.frag?.url);

      setStatus("Video data received.");
    });

    hls.on(Hls.Events.ERROR, function(event, data) {

      console.error("HLS ERROR", data);

      setStatus(
        "HLS Error: " +
        data.type +
        " / " +
        data.details +
        " / fatal=" +
        data.fatal
      );

      if (data.fatal) {

        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR
        ) {

          setStatus(
            "Network error. Retrying..."
          );

          hls.startLoad();

        } else if (
          data.type === Hls.ErrorTypes.MEDIA_ERROR
        ) {

          setStatus(
            "Media error. Recovering..."
          );

          hls.recoverMediaError();

        } else {

          setStatus(
            "Fatal HLS error: " +
            data.details
          );
        }
      }
    });

    hls.loadSource(playlist);
    hls.attachMedia(video);

    window.hls = hls;

    return;
  }

  /*
   * Safari / native HLS support.
   */
  if (
    video.canPlayType(
      "application/vnd.apple.mpegurl"
    )
  ) {

    video.src = playlist;

    video.addEventListener(
      "loadedmetadata",
      function() {

        setStatus(
          "Playlist loaded. Press Play."
        );

        video.play().catch(function() {});
      }
    );

    return;
  }

  setStatus(
    "This browser does not support HLS."
  );
}

video.addEventListener("error", function() {

  console.error(
    "VIDEO ERROR",
    video.error
  );

  if (video.error) {
    setStatus(
      "Video error code: " +
      video.error.code
    );
  }
});

startPlayer();
</script>

</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/* =========================================================
   HELPERS
========================================================= */

function isPlaylist(contentType, pathname) {
  const type = (contentType || "").toLowerCase();

  return (
    type.includes("mpegurl") ||
    type.includes("m3u8") ||
    pathname.toLowerCase().endsWith(".m3u8")
  );
}

function guessContentType(pathname) {
  const path = pathname.toLowerCase();

  if (path.endsWith(".m3u8")) {
    return "application/vnd.apple.mpegurl";
  }

  if (path.endsWith(".ts")) {
    return "video/mp2t";
  }

  if (path.endsWith(".aac")) {
    return "audio/aac";
  }

  if (path.endsWith(".mp4")) {
    return "video/mp4";
  }

  if (path.endsWith(".m4s")) {
    return "video/iso.segment";
  }

  return "application/octet-stream";
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function addCors(headers) {
  headers.set(
    "Access-Control-Allow-Origin",
    "*"
  );

  headers.set(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  headers.set(
    "Access-Control-Allow-Headers",
    "*"
  );
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control": "no-store",

        ...corsHeaders(),
      },
    }
  );
      }
