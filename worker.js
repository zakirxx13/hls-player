/*
 * ============================================================
 * SOMOY TV - HLS CLOUDFLARE WORKER
 * ============================================================
 *
 * Homepage:
 *   /
 *
 * Health:
 *   /health
 *
 * HLS:
 *   /cdn/live/somoy_tv/playlist.m3u8
 *
 * Proxy:
 *   /proxy/cdn/live/somoy_tv/...
 *
 * ============================================================
 */


/* ============================================================
   CHANNEL DATA
   ============================================================ */

const CHANNEL = {
  category: "News Channel",

  name: "Somoy TV",

  link:
    "https://bldcmprod-cdn.toffeelive.com/cdn/live/somoy_tv/playlist.m3u8",

  logo:
    "https://assets-prod.services.toffeelive.com//Xi_Ga5oBNnOkwJLWkhKP/posters/ef2899d5-1ae4-4fee-aee5-45f9b0b3ba80.png",

  /*
   * IMPORTANT:
   *
   * Put your authorized Edge-Cache-Cookie here.
   *
   * Do NOT publish this value in GitHub.
   */
  cookie:
    "Edge-Cache-Cookie=URLPrefix=aHR0cHM6Ly9ibGRjbXByb2QtY2RuLnRvZmZlZWxpdmUuY29t:Expires=1790008980:KeyName=prod_linear:Signature=gOntAaGoMqPzjgvez0CKt0b96wi6llY142HtRMr6sSZmqtPn0uAN8IOA54Tkf2BONxKfnBuu4-yPmwHkVFk5Bg",

  user_agent:
    "okhttp/4.11.0"
};


/* ============================================================
   CDN CONFIG
   ============================================================ */

const CDN_HOST =
  "bldcmprod-cdn.toffeelive.com";

const CDN_USER_AGENT =
  CHANNEL.user_agent;


/* ============================================================
   PLAYER HTML
   ============================================================ */

const PLAYER_HTML = `<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>${CHANNEL.name}</title>

<script
  src="https://cdn.jsdelivr.net/npm/hls.js@latest">
</script>


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
      #263238,
      #080808 65%
    );

  color: white;

  font-family:
    Arial,
    sans-serif;

  display: flex;

  align-items: center;

  justify-content: center;

  padding: 20px;

}


.container {

  width: min(
    900px,
    100%
  );

  background:
    rgba(
      255,
      255,
      255,
      0.08
    );

  border:
    1px solid
    rgba(
      255,
      255,
      255,
      0.15
    );

  border-radius: 22px;

  overflow: hidden;

  backdrop-filter:
    blur(20px);

  box-shadow:
    0 20px 60px
    rgba(
      0,
      0,
      0,
      0.5
    );

}


video {

  width: 100%;

  display: block;

  aspect-ratio: 16 / 9;

  background: #000;

}


.info {

  padding: 18px;

}


.channel {

  display: flex;

  align-items: center;

  gap: 12px;

}


.logo {

  width: 48px;

  height: 48px;

  border-radius: 12px;

  object-fit: contain;

  background: #fff;

}


.name {

  font-size: 20px;

  font-weight: bold;

}


.category {

  margin-top: 4px;

  font-size: 13px;

  color: #aaa;

}


.status {

  margin-top: 14px;

  font-size: 14px;

  color: #aaa;

  word-break: break-word;

}

</style>

</head>


<body>


<div class="container">


  <video
    id="video"
    controls
    playsinline>
  </video>


  <div class="info">


    <div class="channel">


      <img
        class="logo"
        src="${CHANNEL.logo}"
        alt="${CHANNEL.name}"
      >


      <div>


        <div class="name">
          ${CHANNEL.name}
        </div>


        <div class="category">
          ${CHANNEL.category}
        </div>


      </div>


    </div>


    <div
      class="status"
      id="status">

      Connecting...

    </div>


  </div>


</div>


<script>


const video =
  document.getElementById(
    "video"
  );


const status =
  document.getElementById(
    "status"
  );


const stream =
  location.origin +
  "/cdn/live/somoy_tv/playlist.m3u8";


function setStatus(text) {

  status.textContent =
    text;

}


/* ============================================================
   HLS.JS
   ============================================================ */

if (
  window.Hls &&
  Hls.isSupported()
) {


  const hls =
    new Hls({

      enableWorker: true,

      lowLatencyMode: true

    });


  hls.loadSource(
    stream
  );


  hls.attachMedia(
    video
  );


  hls.on(
    Hls.Events.MANIFEST_PARSED,

    function() {

      setStatus(
        "Stream connected"
      );

      video
        .play()
        .catch(
          function() {}
        );

    }
  );


  hls.on(
    Hls.Events.ERROR,

    function(
      event,
      data
    ) {

      console.log(
        "HLS error:",
        data
      );


      if (
        data.fatal
      ) {

        setStatus(
          "HLS error: " +
          data.type
        );

      }

    }
  );

}


/* ============================================================
   NATIVE HLS
   ============================================================ */

else if (
  video.canPlayType(
    "application/vnd.apple.mpegurl"
  )
) {


  video.src =
    stream;


  video.addEventListener(
    "loadedmetadata",

    function() {

      setStatus(
        "Stream connected"
      );

      video
        .play()
        .catch(
          function() {}
        );

    }
  );

}


/* ============================================================
   HLS NOT SUPPORTED
   ============================================================ */

else {

  setStatus(
    "HLS is not supported by this browser."
  );

}


</script>


</body>

</html>`;


/* ============================================================
   CLOUDFLARE WORKER
   ============================================================ */

export default {


  async fetch(
    request
  ) {


    const url =
      new URL(
        request.url
      );


    /* ========================================================
       OPTIONS / CORS
       ======================================================== */

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,

          headers:
            corsHeaders()
        }
      );

    }


    /* ========================================================
       ALLOW GET / HEAD ONLY
       ======================================================== */

    if (
      request.method !==
        "GET" &&

      request.method !==
        "HEAD"
    ) {

      return new Response(
        "Method Not Allowed",

        {
          status: 405,

          headers:
            corsHeaders()
        }
      );

    }


    /* ========================================================
       HOMEPAGE
       ======================================================== */

    if (
      url.pathname === "/" ||

      url.pathname ===
      "/index.html"
    ) {

      return new Response(
        PLAYER_HTML,

        {

          status: 200,

          headers: {

            "Content-Type":
              "text/html; charset=UTF-8",

            "Cache-Control":
              "no-store"

          }

        }
      );

    }


    /* ========================================================
       HEALTH CHECK
       ======================================================== */

    if (
      url.pathname ===
      "/health"
    ) {

      return json(

        {

          ok: true,

          worker:
            "online",

          channel:
            CHANNEL.name,

          category:
            CHANNEL.category,

          upstream:
            CHANNEL.link,

          user_agent:
            CHANNEL.user_agent,

          cookie_configured:
            CHANNEL.cookie !==
            "PASTE_YOUR_EDGE_CACHE_COOKIE_HERE",

          time:
            new Date()
              .toISOString()

        },

        200

      );

    }


    /* ========================================================
       ONLY HLS LIVE PATH
       ======================================================== */

    let pathname =
      url.pathname;


    /*
     * /proxy/cdn/live/...
     *
     * becomes
     *
     * /cdn/live/...
     */

    if (
      pathname.startsWith(
        "/proxy/"
      )
    ) {

      pathname =
        pathname.substring(
          "/proxy".length
        );

    }


    /*
     * Prevent this Worker from becoming
     * an arbitrary open proxy.
     */

    if (
      !pathname.startsWith(
        "/cdn/live/somoy_tv/"
      )
    ) {

      return new Response(
        "Not Found",

        {

          status: 404,

          headers:
            corsHeaders()

        }

      );

    }


    /* ========================================================
       UPSTREAM URL
       ======================================================== */

    const upstreamURL =
      `https://${CDN_HOST}` +
      `${pathname}` +
      `${url.search}`;


    /* ========================================================
       UPSTREAM HEADERS
       ======================================================== */

    const upstreamHeaders =
      new Headers();


    upstreamHeaders.set(
      "User-Agent",
      CDN_USER_AGENT
    );


    upstreamHeaders.set(
      "Accept",
      "*/*"
    );


    upstreamHeaders.set(
      "Accept-Encoding",
      "identity"
    );


    /*
     * Authorized CDN cookie.
     */

    if (
      CHANNEL.cookie &&
      CHANNEL.cookie !==
      "PASTE_YOUR_EDGE_CACHE_COOKIE_HERE"
    ) {

      upstreamHeaders.set(
        "Cookie",
        CHANNEL.cookie
      );

    }


    /*
     * Forward Range.
     */

    const range =
      request.headers.get(
        "Range"
      );


    if (range) {

      upstreamHeaders.set(
        "Range",
        range
      );

    }


    /* ========================================================
       FETCH CDN
       ======================================================== */

    let upstream;


    try {

      upstream =
        await fetch(

          upstreamURL,

          {

            method:
              request.method,

            headers:
              upstreamHeaders,

            redirect:
              "follow"

          }

        );

    }

    catch (error) {

      return json(

        {

          ok: false,

          error:
            "UPSTREAM_FETCH_FAILED",

          message:
            String(error),

          target:
            upstreamURL

        },

        502

      );

    }


    /* ========================================================
       RESPONSE INFORMATION
       ======================================================== */

    const contentType =
      upstream.headers.get(
        "Content-Type"
      ) || "";


    const isPlaylist =

      pathname.endsWith(
        ".m3u8"
      ) ||

      contentType.includes(
        "mpegurl"
      ) ||

      contentType.includes(
        "vnd.apple.mpegurl"
      );


    /* ========================================================
       M3U8 PLAYLIST
       ======================================================== */

    if (isPlaylist) {


      const playlist =
        await upstream.text();


      const rewritten =
        rewritePlaylist(

          playlist,

          upstreamURL

        );


      const headers =
        new Headers(
          upstream.headers
        );


      headers.set(

        "Content-Type",

        "application/vnd.apple.mpegurl"

      );


      headers.set(

        "Cache-Control",

        "no-store"

      );


      headers.delete(
        "Set-Cookie"
      );


      addCors(
        headers
      );


      return new Response(

        rewritten,

        {

          status:
            upstream.status,

          statusText:
            upstream.statusText,

          headers:
            headers

        }

      );

    }


    /* ========================================================
       VIDEO SEGMENT / KEY / OTHER HLS RESOURCE
       ======================================================== */

    const responseHeaders =
      new Headers(
        upstream.headers
      );


    responseHeaders.delete(
      "Set-Cookie"
    );


    addCors(
      responseHeaders
    );


    return new Response(

      upstream.body,

      {

        status:
          upstream.status,

        statusText:
          upstream.statusText,

        headers:
          responseHeaders

      }

    );

  }

};


/* ============================================================
   PLAYLIST REWRITER
   ============================================================ */

function rewritePlaylist(

  playlist,

  currentURL

) {


  return playlist

    .split(/\r?\n/)

    .map(

      function(line) {


        const trimmed =
          line.trim();


        /*
         * Empty line
         */

        if (
          !trimmed
        ) {

          return line;

        }


        /*
         * HLS tags containing URI
         *
         * Example:
         *
         * #EXT-X-KEY:URI="..."
         *
         * #EXT-X-MAP:URI="..."
         */

        if (
          trimmed.startsWith(
            "#"
          )
        ) {

          return line.replace(

            /URI="([^"]+)"/g,

            function(
              match,
              uri
            ) {

              return (
                'URI="' +
                convertToProxyURL(
                  uri,
                  currentURL
                ) +
                '"'
              );

            }

          );

        }


        /*
         * Normal segment / playlist URL
         */

        return convertToProxyURL(

          trimmed,

          currentURL

        );

      }

    )

    .join("\n");

}


/* ============================================================
   CONVERT CDN URL TO WORKER URL
   ============================================================ */

function convertToProxyURL(

  resource,

  currentURL

) {


  try {


    const absoluteURL =
      new URL(

        resource,

        currentURL

      );


    /*
     * Only rewrite our CDN.
     */

    if (
      absoluteURL.hostname !==
      CDN_HOST
    ) {

      return resource;

    }


    return (

      "/proxy" +

      absoluteURL.pathname +

      absoluteURL.search

    );


  }

  catch (
    error
  ) {

    return resource;

  }

}


/* ============================================================
   CORS
   ============================================================ */

function corsHeaders() {

  return {

    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET, HEAD, OPTIONS",

    "Access-Control-Allow-Headers":
      "*",

    "Access-Control-Expose-Headers":
      "*"

  };

}


function addCors(
  headers
) {

  headers.set(

    "Access-Control-Allow-Origin",

    "*"

  );


  headers.set(

    "Access-Control-Allow-Methods",

    "GET, HEAD, OPTIONS"

  );


  headers.set(

    "Access-Control-Allow-Headers",

    "*"

  );


  headers.set(

    "Access-Control-Expose-Headers",

    "*"

  );

}


/* ============================================================
   JSON RESPONSE
   ============================================================ */

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
          "application/json",

        ...corsHeaders()

      }

    }

  );

    }
