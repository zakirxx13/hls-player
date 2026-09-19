const CONFIG = {
  PLAYLIST_URL:
    "https://toffee-stream-keeper.lovable.app/toffee.m3u",

  USER_AGENT: "okhttp/4.11.0",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(),
        });
      }

      if (url.pathname === "/") {
        return playerPage(request);
      }

      if (url.pathname === "/channels") {
        return getChannels();
      }

      if (url.pathname === "/stream") {
        return stream(request, env);
      }

      if (url.pathname === "/debug") {
        return debug(env);
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
   GET PUBLIC CHANNEL LIST
========================================================= */

async function getChannels() {
  const response = await fetch(
    CONFIG.PLAYLIST_URL,
    {
      headers: {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept": "*/*",
      },
    }
  );

  if (!response.ok) {
    return json(
      {
        ok: false,
        error: "Unable to load playlist",
        status: response.status,
      },
      502
    );
  }

  const text = await response.text();

  const channels = parsePlaylist(text);

  /*
   * Never return cookies to browser.
   */
  const safeChannels = channels.map(
    (channel, index) => ({
      id: index,

      category:
        channel.category || "Other",

      name:
        channel.name || `Channel ${index + 1}`,

      link:
        channel.link || "",

      logo:
        channel.logo || "",
    })
  );

  return json({
    ok: true,
    total: safeChannels.length,
    channels: safeChannels,
  });
}


/* =========================================================
   PLAYLIST PARSER
========================================================= */

function parsePlaylist(text) {
  let data;

  try {
    data = JSON.parse(text);

    if (Array.isArray(data)) {
      return data;
    }

    if (Array.isArray(data.channels)) {
      return data.channels;
    }
  } catch {}

  /*
   * Basic M3U parser fallback
   */
  const lines =
    text.split(/\r?\n/);

  const result = [];

  let current = {};

  for (const line of lines) {
    const value = line.trim();

    if (!value) {
      continue;
    }

    if (
      value.startsWith("#EXTINF")
    ) {
      const logo =
        value.match(
          /tvg-logo="([^"]*)"/i
        )?.[1] || "";

      const group =
        value.match(
          /group-title="([^"]*)"/i
        )?.[1] || "";

      const comma =
        value.lastIndexOf(",");

      const name =
        comma >= 0
          ? value
              .slice(comma + 1)
              .trim()
          : "Unknown";

      current = {
        name,
        category: group,
        logo,
      };

      continue;
    }

    if (
      !value.startsWith("#") &&
      /^https?:\/\//i.test(value)
    ) {
      current.link = value;

      result.push(current);

      current = {};
    }
  }

  return result;
}


/* =========================================================
   STREAM
========================================================= */

async function stream(request, env) {
  const url =
    new URL(request.url);

  const target =
    url.searchParams.get("url");

  if (!target) {
    return json(
      {
        ok: false,
        error:
          "Missing ?url= parameter",
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
   * Only permit your configured
   * authorized origin.
   */
  const allowedOrigin =
    new URL(
      env.AUTHORIZED_HLS_ORIGIN ||
      "https://YOUR-AUTHORIZED-DOMAIN.example"
    ).origin;

  if (
    targetUrl.origin !==
    allowedOrigin
  ) {
    return json(
      {
        ok: false,
        error:
          "Unauthorized upstream origin",
      },
      403
    );
  }

  const headers =
    new Headers();

  headers.set(
    "User-Agent",
    CONFIG.USER_AGENT
  );

  headers.set(
    "Accept",
    "*/*"
  );

  /*
   * Secret stays server-side.
   */
  if (
    env.EDGE_CACHE_COOKIE
  ) {
    headers.set(
      "Cookie",
      `Edge-Cache-Cookie=${env.EDGE_CACHE_COOKIE}`
    );
  }

  const response =
    await fetch(
      targetUrl.href,
      {
        method: "GET",
        headers,
        redirect: "follow",
      }
    );

  if (!response.ok) {
    return json(
      {
        ok: false,
        status:
          response.status,
        statusText:
          response.statusText,
      },
      502
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) ||
    guessContentType(
      targetUrl.pathname
    );

  /*
   * Nested HLS playlist
   */
  if (
    isPlaylist(
      contentType,
      targetUrl.pathname
    )
  ) {
    const playlist =
      await response.text();

    const origin =
      new URL(request.url)
        .origin;

    const rewritten =
      rewritePlaylist(
        playlist,
        response.url ||
          targetUrl.href,
        origin,
        env.AUTHORIZED_HLS_ORIGIN
      );

    return new Response(
      rewritten,
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/vnd.apple.mpegurl",

          "Cache-Control":
            "no-store",

          ...corsHeaders(),
        },
      }
    );
  }

  const outputHeaders =
    new Headers();

  outputHeaders.set(
    "Content-Type",
    contentType
  );

  outputHeaders.set(
    "Cache-Control",
    "no-store"
  );

  addCors(
    outputHeaders
  );

  return new Response(
    response.body,
    {
      status: response.status,
      headers: outputHeaders,
    }
  );
}


/* =========================================================
   HLS URL REWRITE
========================================================= */

function rewritePlaylist(
  playlist,
  playlistUrl,
  workerOrigin,
  allowedOrigin
) {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed =
        line.trim();

      if (!trimmed) {
        return line;
      }

      /*
       * Rewrite URI="..."
       */
      if (
        trimmed.startsWith("#")
      ) {
        return line.replace(
          /URI="([^"]+)"/gi,
          (_, uri) => {
            try {
              const absolute =
                new URL(
                  uri,
                  playlistUrl
                );

              if (
                absolute.origin !==
                allowedOrigin
              ) {
                return `URI="${uri}"`;
              }

              return (
                `URI="${workerOrigin}` +
                `/stream?url=` +
                encodeURIComponent(
                  absolute.href
                ) +
                `"`
              );
            } catch {
              return `URI="${uri}"`;
            }
          }
        );
      }

      /*
       * Relative URL:
       *
       * ../slang/...
       * segment.ts
       * ./segment.ts
       */
      try {
        const absolute =
          new URL(
            trimmed,
            playlistUrl
          );

        if (
          absolute.origin !==
          allowedOrigin
        ) {
          return line;
        }

        return (
          workerOrigin +
          "/stream?url=" +
          encodeURIComponent(
            absolute.href
          )
        );
      } catch {
        return line;
      }
    })
    .join("\n");
}


/* =========================================================
   DEBUG
========================================================= */

async function debug(env) {
  return json({
    ok: true,

    playlist:
      CONFIG.PLAYLIST_URL,

    cookieConfigured:
      Boolean(
        env.EDGE_CACHE_COOKIE
      ),

    authorizedOrigin:
      env.AUTHORIZED_HLS_ORIGIN ||
      null,

    endpoints: {
      player: "/",
      channels: "/channels",
      stream: "/stream?url=...",
      debug: "/debug",
    },
  });
}


/* =========================================================
   PLAYER
========================================================= */

function playerPage(request) {
  const origin =
    new URL(request.url)
      .origin;

  const html = `<!DOCTYPE html>
<html>
<head>

<meta charset="UTF-8">

<meta
 name="viewport"
 content="width=device-width,initial-scale=1"
>

<title>Live TV</title>

<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>

<style>

* {
 box-sizing: border-box;
}

body {
 margin: 0;
 padding: 16px;

 background:
 linear-gradient(
   135deg,
   #090d16,
   #172238
 );

 color: white;

 font-family: Arial;
}

.app {
 max-width: 1000px;
 margin: auto;
}

.player {
 background:
 rgba(255,255,255,.08);

 border:
 1px solid rgba(255,255,255,.15);

 border-radius: 22px;

 padding: 14px;

 backdrop-filter: blur(20px);
}

video {
 width: 100%;

 aspect-ratio: 16/9;

 background: black;

 border-radius: 16px;
}

#channels {
 display: grid;

 grid-template-columns:
 repeat(
   auto-fill,
   minmax(150px,1fr)
 );

 gap: 10px;

 margin-top: 15px;
}

.channel {
 padding: 10px;

 border-radius: 15px;

 background:
 rgba(255,255,255,.08);

 border:
 1px solid
 rgba(255,255,255,.12);

 cursor: pointer;
}

.channel img {
 width: 55px;
 height: 55px;

 object-fit: contain;

 display: block;

 margin-bottom: 7px;
}

.name {
 font-weight: bold;
}

.category {
 opacity: .65;

 font-size: 12px;

 margin-top: 4px;
}

#status {
 margin-top: 10px;

 padding: 10px;

 border-radius: 12px;

 background:
 rgba(0,0,0,.25);
}

</style>

</head>

<body>

<div class="app">

<div class="player">

<h2>Live TV</h2>

<video
 id="video"
 controls
 playsinline>
</video>

<div id="status">
Loading channels...
</div>

<div id="channels"></div>

</div>

</div>

<script>

const API =
 ${JSON.stringify(origin)};

const video =
 document.getElementById("video");

const status =
 document.getElementById("status");

const container =
 document.getElementById("channels");

let hls = null;


function setStatus(text) {
 status.textContent = text;
}


async function loadChannels() {

 try {

   const response =
     await fetch(
       API + "/channels"
     );

   const data =
     await response.json();

   if (
     !data.ok
   ) {
     throw new Error(
       data.error ||
       "Unable to load channels"
     );
   }

   container.innerHTML = "";

   data.channels.forEach(
     (channel) => {

       const card =
         document.createElement(
           "div"
         );

       card.className =
         "channel";

       card.innerHTML = \`
         <img
           src="\${channel.logo || ""}"
           onerror="this.style.display='none'"
         >

         <div class="name">
           \${escapeHtml(channel.name)}
         </div>

         <div class="category">
           \${escapeHtml(channel.category)}
         </div>
       \`;

       card.onclick =
         () => playChannel(
           channel
         );

       container.appendChild(
         card
       );
     }
   );

   setStatus(
     data.total +
     " channels loaded"
   );

 } catch (error) {

   console.error(error);

   setStatus(
     "Channel error: " +
     error.message
   );
 }
}


function playChannel(channel) {

 if (!channel.link) {
   setStatus(
     "Channel URL unavailable"
   );

   return;
 }

 const proxyUrl =
   API +
   "/stream?url=" +
   encodeURIComponent(
     channel.link
   );

 if (
   hls
 ) {
   hls.destroy();

   hls = null;
 }

 if (
   window.Hls &&
   Hls.isSupported()
 ) {

   hls =
     new Hls({
       enableWorker: true,

       lowLatencyMode: true,

       backBufferLength: 30
     });

   hls.on(
     Hls.Events.MANIFEST_PARSED,
     () => {

       setStatus(
         "Playing: " +
         channel.name
       );

       video.play()
         .catch(() => {});
     }
   );

   hls.on(
     Hls.Events.ERROR,
     (event, data) => {

       console.error(
         "HLS ERROR",
         data
       );

       setStatus(
         "HLS Error: " +
         data.details
       );
     }
   );

   hls.loadSource(
     proxyUrl
   );

   hls.attachMedia(
     video
   );

 } else if (
   video.canPlayType(
     "application/vnd.apple.mpegurl"
   )
 ) {

   video.src =
     proxyUrl;

   video.play()
     .catch(() => {});

 }
}


function escapeHtml(value) {

 return String(value || "")
   .replace(
     /&/g,
     "&amp;"
   )
   .replace(
     /</g,
     "&lt;"
   )
   .replace(
     />/g,
     "&gt;"
   )
   .replace(
     /"/g,
     "&quot;"
   )
   .replace(
     /'/g,
     "&#039;"
   );
}


loadChannels();

</script>

</body>
</html>`;

  return new Response(
    html,
    {
      headers: {
        "Content-Type":
          "text/html; charset=utf-8",
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

  if (
    path.endsWith(".m3u8")
  ) {
    return "application/vnd.apple.mpegurl";
  }

  if (
    path.endsWith(".ts")
  ) {
    return "video/mp2t";
  }

  if (
    path.endsWith(".aac")
  ) {
    return "audio/aac";
  }

  if (
    path.endsWith(".m4s")
  ) {
    return "video/iso.segment";
  }

  return "application/octet-stream";
}


function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":
      "*",

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
