/*
 * ============================================================
 * HLS DEBUG PROXY - SOMOY TV
 * ============================================================
 */

const CHANNEL = {
  category: "News Channel",

  name: "Somoy TV",

  link:
    "https://bldcmprod-cdn.toffeelive.com/cdn/live/somoy_tv/playlist.m3u8",

  logo:
    "https://assets-prod.services.toffeelive.com//Xi_Ga5oBNnOkwJLWkhKP/posters/ef2899d5-1ae4-4fee-aee5-45f9b0b3ba80.png",

  /*
   * তোমার authorized Edge-Cache-Cookie এখানে বসাও।
   *
   * Format:
   *
   * Edge-Cache-Cookie=...
   *
   * এখানে নিজের আসল value বসাবে।
   */
  cookie:
    "Edge-Cache-Cookie=URLPrefix=aHR0cHM6Ly9ibGRjbXByb2QtY2RuLnRvZmZlZWxpdmUuY29t:Expires=1790009400:KeyName=prod_linear:Signature=xMljSvmCVtgmO_vZGPxckgUbFKrfJwU6G6xLvINarudszkYcVYS1VzrOpnICdQCARYlpOML5YN95R1_BRJiQDg",

  user_agent:
    "okhttp/4.11.0"
};


const CDN_HOST =
  "bldcmprod-cdn.toffeelive.com";


/*
 * ============================================================
 * DEBUG LOGGER
 * ============================================================
 */

function debugLog(...args) {

  console.log(
    "[HLS DEBUG]",
    ...args
  );

}


/*
 * ============================================================
 * CORS
 * ============================================================
 */

function corsHeaders() {

  return {

    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "GET, HEAD, OPTIONS",

    "Access-Control-Allow-Headers":
      "*",

    "Access-Control-Expose-Headers":
      "*"

  };

}


function addCors(headers) {

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


/*
 * ============================================================
 * JSON
 * ============================================================
 */

function json(data, status = 200) {

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


/*
 * ============================================================
 * PLAYER
 * ============================================================
 */

const PLAYER_HTML = `<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>Somoy TV - Debug Player</title>

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
    #080808;

  color: white;

  font-family:
    Arial,
    sans-serif;

  padding: 20px;

}

.container {

  width: min(
    900px,
    100%
  );

  margin: auto;

}

.card {

  background:
    #151515;

  border:
    1px solid #333;

  border-radius:
    18px;

  overflow:
    hidden;

}

video {

  width: 100%;

  display: block;

  background: #000;

  aspect-ratio:
    16 / 9;

}

.info {

  padding: 18px;

}

.title {

  font-size: 21px;

  font-weight: bold;

}

.status {

  margin-top: 10px;

  padding: 12px;

  border-radius: 10px;

  background:
    #202020;

  color: #aaa;

  font-size: 14px;

  word-break: break-word;

}

pre {

  white-space:
    pre-wrap;

  word-break:
    break-word;

  background:
    #050505;

  padding:
    12px;

  border-radius:
    10px;

  font-size:
    12px;

  color:
    #aaa;

  overflow:
    auto;

}

button {

  margin-top:
    10px;

  padding:
    10px 15px;

  border: 0;

  border-radius:
    10px;

  background:
    #2b2b2b;

  color: white;

}

</style>

</head>


<body>

<div class="container">

  <div class="card">

    <video
      id="video"
      controls
      playsinline>
    </video>

    <div class="info">

      <div class="title">
        Somoy TV
      </div>

      <div
        id="status"
        class="status">

        Starting...

      </div>

      <button
        onclick="testM3U8()">

        Test M3U8

      </button>

      <pre id="debug">
Waiting for debug information...
      </pre>

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

const debug =
  document.getElementById(
    "debug"
  );


const stream =
  location.origin +
  "/cdn/live/somoy_tv/playlist.m3u8";


function setStatus(text) {

  status.textContent =
    text;

}


function setDebug(data) {

  debug.textContent =
    typeof data === "string"
      ? data
      : JSON.stringify(
          data,
          null,
          2
        );

}


/*
 * ============================================================
 * DIRECT M3U8 TEST
 * ============================================================
 */

async function testM3U8() {

  setStatus(
    "Testing M3U8..."
  );

  setDebug(
    "Requesting:\\n" +
    stream
  );

  try {

    const response =
      await fetch(
        stream,
        {
          method:
            "GET",

          cache:
            "no-store"
        }
      );


    const text =
      await response.text();


    setDebug({

      url:
        stream,

      status:
        response.status,

      statusText:
        response.statusText,

      contentType:
        response.headers.get(
          "content-type"
        ),

      contentLength:
        response.headers.get(
          "content-length"
        ),

      first500:
        text.substring(
          0,
          500
        )

    });


    if (
      !response.ok
    ) {

      setStatus(
        "M3U8 HTTP error: " +
        response.status
      );

      return;

    }


    if (
      text.includes(
        "#EXTM3U"
      )
    ) {

      setStatus(
        "M3U8 received successfully"
      );

    }
    else {

      setStatus(
        "Response received, but not a valid M3U8"
      );

    }

  }

  catch(error) {

    setStatus(
      "M3U8 network error"
    );

    setDebug({

      error:
        String(error),

      name:
        error.name,

      message:
        error.message,

      url:
        stream

    });

  }

}


/*
 * ============================================================
 * HLS.JS
 * ============================================================
 */

if (
  window.Hls &&
  Hls.isSupported()
) {

  const hls =
    new Hls({

      enableWorker:
        true,

      lowLatencyMode:
        true,

      debug:
        true

    });


  hls.on(
    Hls.Events.MEDIA_ATTACHED,

    function() {

      setStatus(
        "Media attached. Loading playlist..."
      );

    }
  );


  hls.on(
    Hls.Events.MANIFEST_LOADING,

    function(
      event,
      data
    ) {

      setStatus(
        "Loading M3U8..."
      );

      setDebug({

        event:
          "MANIFEST_LOADING",

        url:
          data.url

      });

    }
  );


  hls.on(
    Hls.Events.MANIFEST_LOADED,

    function(
      event,
      data
    ) {

      setDebug({

        event:
          "MANIFEST_LOADED",

        url:
          data.url,

        stats:
          data.stats

      });

    }
  );


  hls.on(
    Hls.Events.MANIFEST_PARSED,

    function(
      event,
      data
    ) {

      setStatus(
        "Manifest parsed successfully"
      );

      setDebug({

        event:
          "MANIFEST_PARSED",

        levels:
          data.levels?.length,

        firstLevel:
          data.levels?.[0]

      });


      video
        .play()
        .catch(
          function(error) {

            setDebug({

              autoplay:
                "blocked",

              error:
                String(error)

            });

          }
        );

    }
  );


  hls.on(
    Hls.Events.FRAG_LOADING,

    function(
      event,
      data
    ) {

      setDebug({

        event:
          "FRAG_LOADING",

        url:
          data.frag?.url

      });

    }
  );


  hls.on(
    Hls.Events.ERROR,

    function(
      event,
      data
    ) {

      console.error(
        "HLS ERROR:",
        data
      );


      setStatus(

        "HLS error: " +
        data.type +
        " / " +
        data.details

      );


      setDebug({

        event:
          "HLS_ERROR",

        type:
          data.type,

        details:
          data.details,

        fatal:
          data.fatal,

        url:
          data.url,

        response:
          data.response,

        networkDetails:
          data.networkDetails
            ? String(
                data.networkDetails
              )
            : null

      });

    }
  );


  hls.loadSource(
    stream
  );


  hls.attachMedia(
    video
  );

}


/*
 * ============================================================
 * NATIVE HLS
 * ============================================================
 */

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
        "Native HLS loaded"
      );

    }

  );

}


/*
 * ============================================================
 * NOT SUPPORTED
 * ============================================================
 */

else {

  setStatus(
    "HLS is not supported"
  );

}

</script>

</body>

</html>`;


/*
 * ============================================================
 * PLAYLIST REWRITE
 * ============================================================
 */

function rewritePlaylist(
  playlist,
  currentURL
) {

  return playlist
    .split(/\r?\n/)
    .map(function(line) {

      const trimmed =
        line.trim();


      if (!trimmed) {
        return line;
      }


      /*
       * HLS tags containing URI
       */

      if (
        trimmed.startsWith("#")
      ) {

        return line.replace(

          /URI="([^"]+)"/g,

          function(
            match,
            uri
          ) {

            return (
              'URI="' +
              convertURL(
                uri,
                currentURL
              ) +
              '"'
            );

          }

        );

      }


      /*
       * Segment / nested playlist
       */

      return convertURL(
        trimmed,
        currentURL
      );

    })
    .join("\n");

}


/*
 * ============================================================
 * URL REWRITE
 * ============================================================
 */

function convertURL(
  resource,
  currentURL
) {

  try {

    const absolute =
      new URL(
        resource,
        currentURL
      );


    /*
     * Only rewrite our CDN.
     */

    if (
      absolute.hostname !==
      CDN_HOST
    ) {

      return resource;

    }


    return (
      "/proxy" +
      absolute.pathname +
      absolute.search
    );

  }

  catch {

    return resource;

  }

}


/*
 * ============================================================
 * WORKER
 * ============================================================
 */

export default {

  async fetch(
    request
  ) {

    const url =
      new URL(
        request.url
      );


    /*
     * OPTIONS
     */

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


    /*
     * Methods
     */

    if (
      request.method !== "GET" &&
      request.method !== "HEAD"
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


    /*
     * Homepage
     */

    if (
      url.pathname === "/" ||
      url.pathname === "/index.html"
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


    /*
     * Health
     */

    if (
      url.pathname === "/health"
    ) {

      return json({

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

        cookie_length:
          CHANNEL.cookie.length,

        time:
          new Date()
            .toISOString()

      });

    }


    /*
     * Debug upstream endpoint
     */

    if (
      url.pathname ===
      "/debug/upstream"
    ) {

      return await debugUpstream();

    }


    /*
     * Proxy path
     */

    let pathname =
      url.pathname;


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
     * Only Somoy TV
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


    /*
     * Upstream URL
     */

    const upstreamURL =
      "https://" +
      CDN_HOST +
      pathname +
      url.search;


    /*
     * Headers
     */

    const headers =
      new Headers();


    headers.set(
      "User-Agent",
      CDN_USER_AGENT
    );


    headers.set(
      "Accept",
      "*/*"
    );


    headers.set(
      "Accept-Encoding",
      "identity"
    );


    /*
     * COOKIE
     */

    if (
      CHANNEL.cookie &&
      CHANNEL.cookie !==
        "PASTE_YOUR_EDGE_CACHE_COOKIE_HERE"
    ) {

      headers.set(
        "Cookie",
        CHANNEL.cookie
      );

    }


    /*
     * Range
     */

    const range =
      request.headers.get(
        "Range"
      );


    if (range) {

      headers.set(
        "Range",
        range
      );

    }


    /*
     * Debug log
     *
     * Cookie value is NEVER logged.
     */

    debugLog(
      "REQUEST",
      {
        method:
          request.method,

        pathname,

        upstreamURL,

        cookie:
          Boolean(
            CHANNEL.cookie &&
            CHANNEL.cookie !==
              "PASTE_YOUR_EDGE_CACHE_COOKIE_HERE"
          ),

        userAgent:
          CDN_USER_AGENT,

        range:
          range || null
      }
    );


    /*
     * Fetch
     */

    let response;


    try {

      response =
        await fetch(

          upstreamURL,

          {

            method:
              request.method,

            headers,

            redirect:
              "follow"

          }

        );

    }

    catch (error) {

      console.error(
        "[UPSTREAM FETCH ERROR]",
        error
      );


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


    /*
     * Response info
     */

    const contentType =
      response.headers.get(
        "Content-Type"
      ) || "";


    console.log(
      "[UPSTREAM RESPONSE]",
      {

        status:
          response.status,

        contentType,

        contentLength:
          response.headers.get(
            "Content-Length"
          ),

        target:
          upstreamURL

      }
    );


    /*
     * Playlist
     */

    const isM3U8 =
      pathname.endsWith(
        ".m3u8"
      ) ||

      contentType.includes(
        "mpegurl"
      ) ||

      contentType.includes(
        "vnd.apple.mpegurl"
      );


    if (isM3U8) {

      const playlist =
        await response.text();


      console.log(
        "[M3U8]",
        {

          status:
            response.status,

          length:
            playlist.length,

          valid:
            playlist.includes(
              "#EXTM3U"
            )

        }
      );


      const rewritten =
        rewritePlaylist(
          playlist,
          upstreamURL
        );


      const outHeaders =
        new Headers(
          response.headers
        );


      outHeaders.set(
        "Content-Type",
        "application/vnd.apple.mpegurl"
      );


      outHeaders.set(
        "Cache-Control",
        "no-store"
      );


      outHeaders.delete(
        "Set-Cookie"
      );


      addCors(
        outHeaders
      );


      return new Response(

        rewritten,

        {

          status:
            response.status,

          statusText:
            response.statusText,

          headers:
            outHeaders

        }

      );

    }


    /*
     * Segment / key
     */

    const outHeaders =
      new Headers(
        response.headers
      );


    outHeaders.delete(
      "Set-Cookie"
    );


    addCors(
      outHeaders
    );


    return new Response(

      response.body,

      {

        status:
          response.status,

        statusText:
          response.statusText,

        headers:
          outHeaders

      }

    );

  }

};


/*
 * ============================================================
 * DIRECT UPSTREAM DEBUG
 * ============================================================
 */

async function debugUpstream() {

  const headers =
    new Headers();


  headers.set(
    "User-Agent",
    CDN_USER_AGENT
  );


  headers.set(
    "Accept",
    "*/*"
  );


  headers.set(
    "Accept-Encoding",
    "identity"
  );


  if (
    CHANNEL.cookie &&
    CHANNEL.cookie !==
      "PASTE_YOUR_EDGE_CACHE_COOKIE_HERE"
  ) {

    headers.set(
      "Cookie",
      CHANNEL.cookie
    );

  }


  const started =
    Date.now();


  try {

    const response =
      await fetch(

        CHANNEL.link,

        {

          method:
            "GET",

          headers,

          redirect:
            "follow"

        }

      );


    const text =
      await response.text();


    return json({

      ok: true,

      status:
        response.status,

      statusText:
        response.statusText,

      contentType:
        response.headers.get(
          "Content-Type"
        ),

      contentLength:
        response.headers.get(
          "Content-Length"
        ),

      responseTime:
        Date.now() -
        started,

      validM3U8:
        text.includes(
          "#EXTM3U"
        ),

      bodyLength:
        text.length,

      preview:
        text.substring(
          0,
          500
        )

    });

  }

  catch (error) {

    return json(

      {

        ok: false,

        error:
          "UPSTREAM_DEBUG_FAILED",

        message:
          String(error),

        responseTime:
          Date.now() -
          started

      },

      502

    );

  }

   }
