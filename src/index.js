const CONFIG = {
  // Your authorized HLS source
  HLS_URL:
    "https://bldcmprod-cdn.toffeelive.com/cdn/live/desh_tv/playlists.m3u8",

  USER_AGENT: "okhttp/4.11.0",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      // CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(),
        });
      }

      // Public player
      if (url.pathname === "/") {
        return playerPage(request);
      }

      // Public HLS playlist
      if (url.pathname === "/playlist.m3u8") {
        return fetchPlaylist(request, env);
      }

      // HLS child playlists / segments
      if (url.pathname === "/proxy") {
        return proxyResource(request, env);
      }

      // Debug
      if (url.pathname === "/debug") {
        return debug(request, env);
      }

      // Upstream test
      if (url.pathname === "/test-upstream") {
        return testUpstream(env);
      }

      return json(
        {
          ok: false,
          error: "Not found",
        },
        404
      );
    } catch (error) {
      return json(
        {
          ok: false,
          error: error?.message || String(error),
        },
        500
      );
    }
  },
};


/* =========================================================
   UPSTREAM HEADERS
========================================================= */

function upstreamHeaders(env, accept = "*/*") {
  const headers = new Headers();

  headers.set("User-Agent", CONFIG.USER_AGENT);
  headers.set("Accept", accept);

  /*
   * The credential is stored only as a Cloudflare Worker
   * secret and is never sent to the browser.
   */
  if (env.EDGE_CACHE_COOKIE) {
    headers.set(
      "Cookie",
      `Edge-Cache-Cookie=${env.EDGE_CACHE_COOKIE}`
    );
  }

  return headers;
}


/* =========================================================
   FETCH MASTER PLAYLIST
========================================================= */

async function fetchPlaylist(request, env) {
  const started = Date.now();

  const response = await fetch(CONFIG.HLS_URL, {
    method: "GET",

    headers: upstreamHeaders(
      env,
      "application/vnd.apple.mpegurl,application/x-mpegURL,*/*"
    ),

    redirect: "follow",
  });

  const body = await response.text();

  if (!response.ok) {
    return json(
      {
        ok: false,
        stage: "playlist",
        status: response.status,
        statusText: response.statusText,
        elapsedMs: Date.now() - started,

        upstreamUrl: CONFIG.HLS_URL,

        bodyPreview: body.slice(0, 1000),
      },
      502
    );
  }

  const workerOrigin = new URL(request.url).origin;

  const rewritten = rewritePlaylistUrls(
    body,
    response.url || CONFIG.HLS_URL,
    workerOrigin
  );

  return new Response(rewritten, {
    status: 200,

    headers: {
      "Content-Type":
        "application/vnd.apple.mpegurl; charset=utf-8",

      "Cache-Control":
        "no-store, no-cache, must-revalidate",

      ...corsHeaders(),

      "X-Proxy-Time":
        String(Date.now() - started),
    },
  });
}


/* =========================================================
   PLAYLIST URL REWRITER
========================================================= */

function rewritePlaylistUrls(
  playlist,
  playlistUrl,
  workerOrigin
) {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return line;
      }

      /*
       * HLS tags containing URI="..."
       */
      if (trimmed.startsWith("#")) {
        return line.replace(
          /URI="([^"]+)"/gi,
          (_, uri) => {
            try {
              const absolute = new URL(
                uri,
                playlistUrl
              ).href;

              return (
                `URI="${workerOrigin}/proxy?url=` +
                encodeURIComponent(absolute) +
                `"`
              );
            } catch {
              return `URI="${uri}"`;
            }
          }
        );
      }

      /*
       * Normal playlist URL.
       *
       * Important:
       * This correctly handles:
       *
       * ../slang/...
       * ./segment...
       * segment.ts
       * /path/file.ts
       * https://...
       */
      try {
        const absolute = new URL(
          trimmed,
          playlistUrl
        ).href;

        return (
          workerOrigin +
          "/proxy?url=" +
          encodeURIComponent(absolute)
        );
      } catch {
        return line;
      }
    })
    .join("\n");
}


/* =========================================================
   PROXY CHILD PLAYLIST / SEGMENT
========================================================= */

async function proxyResource(request, env) {
  const requestUrl = new URL(request.url);

  const target = requestUrl.searchParams.get("url");

  if (!target) {
    return json(
      {
        ok: false,
        error: "Missing url parameter",
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
        error: "Invalid target URL",
      },
      400
    );
  }

  /*
   * SSRF protection:
   * Only proxy resources belonging to the same
   * authorized upstream origin.
   */
  let authorizedOrigin;

  try {
    authorizedOrigin = new URL(
      CONFIG.HLS_URL
    ).origin;
  } catch {
    return json(
      {
        ok: false,
        error: "Invalid HLS_URL configuration",
      },
      500
    );
  }

  if (targetUrl.origin !== authorizedOrigin) {
    return json(
      {
        ok: false,
        error:
          "Target URL is outside the authorized upstream origin.",
      },
      403
    );
  }

  const response = await fetch(targetUrl.href, {
    method: "GET",

    headers: upstreamHeaders(env),

    redirect: "follow",
  });

  if (!response.ok) {
    const errorBody = await response.text();

    return json(
      {
        ok: false,
        stage: "proxy",
        status: response.status,
        statusText: response.statusText,
        target: targetUrl.href,
        bodyPreview: errorBody.slice(0, 500),
      },
      502
    );
  }

  const contentType =
    response.headers.get("content-type") ||
    guessContentType(targetUrl.pathname);

  /*
   * Child .m3u8 playlist
   */
  if (
    isPlaylist(
      contentType,
      targetUrl.pathname
    )
  ) {
    const playlist = await response.text();

    const workerOrigin =
      requestUrl.origin;

    const rewritten =
      rewritePlaylistUrls(
        playlist,
        response.url || targetUrl.href,
        workerOrigin
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
   * TS / AAC / M4S / MP4 / etc.
   */
  const headers = new Headers();

  headers.set(
    "Content-Type",
    contentType
  );

  headers.set(
    "Cache-Control",
    "no-store"
  );

  const length =
    response.headers.get(
      "content-length"
    );

  if (length) {
    headers.set(
      "Content-Length",
      length
    );
  }

  addCors(headers);

  return new Response(
    response.body,
    {
      status: response.status,
      headers,
    }
  );
}


/* =========================================================
   DEBUG
========================================================= */

async function debug(request, env) {
  const workerUrl =
    new URL(request.url);

  const upstream =
    new URL(CONFIG.HLS_URL);

  return json({
    ok: true,

    worker: {
      url: workerUrl.origin,
      path: workerUrl.pathname,
      method: request.method,
      time: new Date().toISOString(),
    },

    configuration: {
      upstreamOrigin: upstream.origin,
      upstreamPath: upstream.pathname,

      userAgent:
        CONFIG.USER_AGENT,

      cookieConfigured:
        Boolean(
          env.EDGE_CACHE_COOKIE
        ),
    },

    endpoints: {
      player:
        `${workerUrl.origin}/`,

      playlist:
        `${workerUrl.origin}/playlist.m3u8`,

      upstreamTest:
        `${workerUrl.origin}/test-upstream`,

      debug:
        `${workerUrl.origin}/debug`,
    },
  });
}


/* =========================================================
   TEST UPSTREAM
========================================================= */

async function testUpstream(env) {
  const started = Date.now();

  let response;

  try {
    response = await fetch(
      CONFIG.HLS_URL,
      {
        method: "GET",

        headers: upstreamHeaders(
          env,
          "application/vnd.apple.mpegurl,*/*"
        ),

        redirect: "follow",
      }
    );
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "fetch",
        error:
          error?.message ||
          String(error),

        elapsedMs:
          Date.now() - started,
      },
      502
    );
  }

  const body =
    await response.text();

  return json({
    ok: response.ok,

    status:
      response.status,

    statusText:
      response.statusText,

    elapsedMs:
      Date.now() - started,

    finalUrl:
      response.url,

    redirected:
      response.redirected,

    contentType:
      response.headers.get(
        "content-type"
      ),

    contentLength:
      response.headers.get(
        "content-length"
      ),

    /*
     * Do not print the Cookie here.
     */
    cookieConfigured:
      Boolean(
        env.EDGE_CACHE_COOKIE
      ),

    bodyPreview:
      body.slice(0, 2000),
  });
}


/* =========================================================
   PLAYER
========================================================= */

function playerPage(request) {
  const origin =
    new URL(request.url).origin;

  const playlist =
    `${origin}/playlist.m3u8`;

  const html = `<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
/>

<title>Live TV</title>

<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;

  min-height: 100vh;

  display: flex;
  justify-content: center;
  align-items: center;

  padding: 16px;

  background:
    radial-gradient(
      circle at top,
      #263852,
      #10141d 55%,
      #07090d
    );

  color: white;

  font-family:
    Arial,
    sans-serif;
}

.container {
  width: 100%;
  max-width: 900px;

  padding: 16px;

  border-radius: 24px;

  background:
    rgba(255,255,255,.08);

  border:
    1px solid rgba(255,255,255,.15);

  backdrop-filter:
    blur(20px);

  -webkit-backdrop-filter:
    blur(20px);

  box-shadow:
    0 20px 70px rgba(0,0,0,.45);
}

.title {
  font-size: 20px;
  font-weight: 700;

  margin:
    4px 4px 14px;
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

  background:
    rgba(0,0,0,.25);

  font-size: 14px;

  word-break: break-word;
}

button {
  margin-top: 12px;

  padding: 11px 15px;

  border-radius: 12px;

  border:
    1px solid rgba(255,255,255,.2);

  background:
    rgba(255,255,255,.1);

  color: white;
}

</style>

</head>

<body>

<div class="container">

<div class="title">
Live TV
</div>

<video
  id="video"
  controls
  playsinline
  preload="auto">
</video>

<div
  id="status"
  class="status">
Loading...
</div>

<button
  onclick="location.href='/debug'">
Debug
</button>

<button
  onclick="location.href='/test-upstream'">
Test Upstream
</button>

</div>

<script>

const video =
  document.getElementById("video");

const status =
  document.getElementById("status");

const playlist =
  ${JSON.stringify(playlist)};

function setStatus(text) {
  status.textContent = text;
  console.log(text);
}

if (
  window.Hls &&
  Hls.isSupported()
) {

  const hls =
    new Hls({
      enableWorker: true,

      lowLatencyMode: true,

      backBufferLength: 30,

      manifestLoadingMaxRetry: 3,

      levelLoadingMaxRetry: 3,

      fragLoadingMaxRetry: 3
    });

  hls.on(
    Hls.Events.MANIFEST_LOADING,
    () => {
      setStatus(
        "Loading playlist..."
      );
    }
  );

  hls.on(
    Hls.Events.MANIFEST_PARSED,
    () => {

      setStatus(
        "Playlist loaded. Press Play."
      );

      video.play()
        .catch(() => {});
    }
  );

  hls.on(
    Hls.Events.FRAG_LOADED,
    () => {

      setStatus(
        "Video data received."
      );
    }
  );

  hls.on(
    Hls.Events.ERROR,
    (event, data) => {

      console.error(
        "HLS ERROR:",
        data
      );

      setStatus(
        "HLS Error: " +
        data.type +
        " / " +
        data.details
      );

      if (
        data.fatal &&
        data.type ===
        Hls.ErrorTypes.NETWORK_ERROR
      ) {
        hls.startLoad();
      }

      if (
        data.fatal &&
        data.type ===
        Hls.ErrorTypes.MEDIA_ERROR
      ) {
        hls.recoverMediaError();
      }
    }
  );

  hls.loadSource(playlist);

  hls.attachMedia(video);

} else if (
  video.canPlayType(
    "application/vnd.apple.mpegurl"
  )
) {

  video.src = playlist;

  video.addEventListener(
    "loadedmetadata",
    () => {

      setStatus(
        "Playlist loaded. Press Play."
      );

      video.play()
        .catch(() => {});
    }
  );

} else {

  setStatus(
    "HLS is not supported."
  );
}

video.addEventListener(
  "error",
  () => {

    if (video.error) {

      setStatus(
        "Video error code: " +
        video.error.code
      );
    }
  }
);

</script>

</body>
</html>`;

  return new Response(
    html,
    {
      status: 200,

      headers: {
        "Content-Type":
          "text/html; charset=utf-8",

        "Cache-Control":
          "no-store",
      },
    }
  );
}


/* =========================================================
   HELPERS
========================================================= */

function isPlaylist(
  contentType,
  pathname
) {
  const type =
    (contentType || "")
      .toLowerCase();

  return (
    type.includes("mpegurl") ||
    type.includes("m3u8") ||
    pathname
      .toLowerCase()
      .endsWith(".m3u8")
  );
}


function guessContentType(
  pathname
) {
  const path =
    pathname.toLowerCase();

  if (path.endsWith(".m3u8")) {
    return "application/vnd.apple.mpegurl";
  }

  if (path.endsWith(".ts")) {
    return "video/mp2t";
  }

  if (path.endsWith(".aac")) {
    return "audio/aac";
  }

  if (path.endsWith(".m4s")) {
    return "video/iso.segment";
  }

  if (path.endsWith(".mp4")) {
    return "video/mp4";
  }

  return "application/octet-stream";
}


function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "GET, OPTIONS",

    "Access-Control-Allow-Headers":
      "*",
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


function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        ...corsHeaders(),
      },
    }
  );
}
