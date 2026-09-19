/**
 * HLS Reverse Proxy - DEBUG VERSION
 *
 * IMPORTANT:
 * Keep your authentication credential private.
 * Do not commit it to a public GitHub repository.
 */

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  baseUrl: 'https://bldcmprod-cdn.toffeelive.com/cdn/live/desh_tv',

  // Keep your existing authorized credential here temporarily
  // OR preferably load it from a Cloudflare Worker Secret.
  cookie: 'Edge-Cache-Cookie=URLPrefix=aHR0cHM6Ly9ibGRjbXByb2QtY2RuLnRvZmZlZWxpdmUuY29t:Expires=1790010960:KeyName=prod_linear:Signature=VX2pepfUQvVv0i_2f7wSdPISEndX5duKPnyA5rQesQOVDZ8S-P2mXOYk7QFYC4L96cQ2yURkoUFl0ahEkW4aDQ',

  userAgent: 'okhttp/4.11.0',

  logo: 'https://assets-prod.services.toffeelive.com/w_640,q_75,f_webp/PiL635oBEef-9-uV2uCe/posters/36f380e0-6c71-4b27-a73b-2afb3ce7e982.png'
};


// ============================================================
// CORS
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400'
};


// ============================================================
// WORKER
// ============================================================

export default {

  async fetch(request, env, ctx) {

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    console.log('================================================');
    console.log('REQUEST');
    console.log('Method:', request.method);
    console.log('Path:', path);
    console.log('URL:', url.href);
    console.log('Time:', new Date().toISOString());
    console.log('================================================');

    try {

      // ------------------------------------------------------
      // DEBUG
      // ------------------------------------------------------

      if (path === '/debug') {
        return debugInfo(request);
      }


      // ------------------------------------------------------
      // TEST UPSTREAM
      // ------------------------------------------------------

      if (path === '/test-upstream') {
        return await testUpstream();
      }


      // ------------------------------------------------------
      // MAIN PLAYLIST
      // ------------------------------------------------------

      if (
        path === '/playlist.m3u8' ||
        path === '/'
      ) {
        return await fetchPlaylist(
          request,
          CONFIG.baseUrl.replace(/\/$/, '') + '/playlist.m3u8',
          url.origin
        );
      }


      // ------------------------------------------------------
      // GENERIC PROXY
      // ------------------------------------------------------

      if (path.startsWith('/proxy/')) {

        const encoded = path.substring('/proxy/'.length);

        let targetUrl;

        try {
          targetUrl = decodeURIComponent(encoded);
        } catch (e) {

          console.error(
            'URL DECODE ERROR:',
            e.message
          );

          return textResponse(
            'Invalid proxy URL encoding',
            400
          );
        }

        console.log('PROXY TARGET:', targetUrl);

        return await proxyContent(
          request,
          targetUrl
        );
      }


      // ------------------------------------------------------
      // SEGMENTS
      // ------------------------------------------------------

      if (path.startsWith('/segments/')) {

        const segmentPath =
          path.substring('/segments/'.length);

        const targetUrl =
          CONFIG.baseUrl.replace(/\/$/, '') +
          '/' +
          segmentPath;

        console.log(
          'SEGMENT TARGET:',
          targetUrl
        );

        return await proxyContent(
          request,
          targetUrl
        );
      }


      // ------------------------------------------------------
      // PLAYER
      // ------------------------------------------------------

      return servePlayerPage(url.origin);

    } catch (error) {

      console.error(
        'WORKER FATAL ERROR:',
        error
      );

      return textResponse(
        'Worker Error: ' + error.message,
        500
      );
    }
  }
};


// ============================================================
// DEBUG INFO
// ============================================================

function debugInfo(request) {

  const url = new URL(request.url);

  const info = {
    status: 'ok',

    worker: {
      url: url.origin,
      path: url.pathname,
      method: request.method,
      time: new Date().toISOString()
    },

    configuration: {
      baseUrl: CONFIG.baseUrl,
      userAgent: CONFIG.userAgent,

      // Never expose the credential
      cookieConfigured:
        !!CONFIG.cookie &&
        CONFIG.cookie !== 'REPLACE_WITH_YOUR_AUTHORIZED_COOKIE'
    },

    endpoints: {
      player: url.origin + '/',
      playlist: url.origin + '/playlist.m3u8',
      upstreamTest: url.origin + '/test-upstream',
      debug: url.origin + '/debug'
    }
  };

  return new Response(
    JSON.stringify(info, null, 2),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    }
  );
}


// ============================================================
// TEST UPSTREAM
// ============================================================

async function testUpstream() {

  const targetUrl =
    CONFIG.baseUrl.replace(/\/$/, '') +
    '/playlist.m3u8';

  console.log('UPSTREAM TEST');
  console.log('Target:', targetUrl);

  const headers = {
    'User-Agent': CONFIG.userAgent,
    'Accept': '*/*'
  };

  if (CONFIG.cookie) {
    headers['Cookie'] = CONFIG.cookie;
  }

  let response;

  const started = Date.now();

  try {

    response = await fetch(
      targetUrl,
      {
        method: 'GET',
        headers,
        redirect: 'follow'
      }
    );

  } catch (error) {

    console.error(
      'UPSTREAM FETCH FAILED:',
      error
    );

    return new Response(
      JSON.stringify({
        ok: false,
        stage: 'fetch',
        error: error.message
      }, null, 2),
      {
        status: 502,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }

  const elapsed = Date.now() - started;

  const result = {
    ok: response.ok,

    status: response.status,

    statusText: response.statusText,

    elapsedMs: elapsed,

    finalUrl: response.url,

    redirected: response.redirected,

    contentType:
      response.headers.get('content-type'),

    contentLength:
      response.headers.get('content-length'),

    cacheStatus:
      response.headers.get('cf-cache-status')
  };

  console.log(
    'UPSTREAM RESULT:',
    JSON.stringify(result)
  );

  // Read a small amount only for diagnostics
  let preview = '';

  try {

    const clone = response.clone();

    const text = await clone.text();

    preview = text.substring(0, 500);

  } catch (e) {

    preview =
      'Unable to read response body: ' +
      e.message;
  }

  result.bodyPreview = preview;

  return new Response(
    JSON.stringify(result, null, 2),
    {
      status: response.ok ? 200 : 502,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    }
  );
}


// ============================================================
// FETCH PLAYLIST
// ============================================================

async function fetchPlaylist(
  request,
  targetUrl,
  origin
) {

  console.log('PLAYLIST REQUEST');
  console.log('Target:', targetUrl);

  const headers = {
    'User-Agent': CONFIG.userAgent,
    'Cookie': CONFIG.cookie,
    'Accept': '*/*'
  };

  let response;

  const started = Date.now();

  try {

    response = await fetch(
      targetUrl,
      {
        method: 'GET',
        headers,
        redirect: 'follow'
      }
    );

  } catch (error) {

    console.error(
      'PLAYLIST FETCH ERROR:',
      error
    );

    return textResponse(
      'Playlist fetch failed: ' +
      error.message,
      502
    );
  }

  const elapsed =
    Date.now() - started;

  console.log(
    'PLAYLIST STATUS:',
    response.status
  );

  console.log(
    'PLAYLIST CONTENT-TYPE:',
    response.headers.get('content-type')
  );

  console.log(
    'PLAYLIST FINAL URL:',
    response.url
  );

  console.log(
    'PLAYLIST TIME:',
    elapsed + 'ms'
  );


  if (!response.ok) {

    const errorBody =
      await safeReadText(response);

    console.error(
      'UPSTREAM PLAYLIST ERROR BODY:',
      errorBody.substring(0, 1000)
    );

    return new Response(
      JSON.stringify({
        error: 'Upstream playlist request failed',
        status: response.status,
        statusText: response.statusText,
        finalUrl: response.url,
        elapsedMs: elapsed,
        bodyPreview:
          errorBody.substring(0, 500)
      }, null, 2),
      {
        status: response.status,
        headers: {
          ...corsHeaders,
          'Content-Type':
            'application/json'
        }
      }
    );
  }


  let body;

  try {

    body = await response.text();

  } catch (error) {

    console.error(
      'PLAYLIST READ ERROR:',
      error
    );

    return textResponse(
      'Could not read playlist: ' +
      error.message,
      502
    );
  }


  console.log(
    'PLAYLIST SIZE:',
    body.length
  );

  console.log(
    'PLAYLIST PREVIEW:',
    body.substring(0, 1000)
  );


  if (!body.includes('#EXTM3U')) {

    console.error(
      'WARNING: Response does not contain #EXTM3U'
    );

    return new Response(
      JSON.stringify({
        error:
          'Upstream returned something other than an HLS playlist',

        status: response.status,

        contentType:
          response.headers.get('content-type'),

        bodyPreview:
          body.substring(0, 1000)

      }, null, 2),
      {
        status: 502,
        headers: {
          ...corsHeaders,
          'Content-Type':
            'application/json'
        }
      }
    );
  }


  // Rewrite playlist
  const rewritten =
    rewritePlaylistUrls(
      body,
      targetUrl,
      origin
    );


  console.log(
    'REWRITTEN PLAYLIST SIZE:',
    rewritten.length
  );


  return new Response(
    rewritten,
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type':
          'application/vnd.apple.mpegurl',
        'Cache-Control':
          'no-store, no-cache, must-revalidate'
      }
    }
  );
}


// ============================================================
// PLAYLIST REWRITER
// ============================================================

function rewritePlaylistUrls(
  playlist,
  playlistUrl,
  origin
) {

  const lines =
    playlist.split(/\r?\n/);

  let rewrittenCount = 0;

  const output =
    lines.map(line => {

      const trimmed =
        line.trim();

      if (!trimmed) {
        return line;
      }


      // ------------------------------------------------------
      // EXT-X-KEY / EXT-X-MAP / OTHER URI="..."
      // ------------------------------------------------------

      if (
        trimmed.startsWith('#') &&
        trimmed.includes('URI="')
      ) {

        return line.replace(
          /URI="([^"]+)"/g,
          (match, uri) => {

            try {

              const absolute =
                new URL(
                  uri,
                  playlistUrl
                ).href;

              rewrittenCount++;

              return (
                'URI="' +
                origin +
                '/proxy/' +
                encodeURIComponent(absolute) +
                '"'
              );

            } catch (e) {

              console.error(
                'URI REWRITE ERROR:',
                uri,
                e.message
              );

              return match;
            }
          }
        );
      }


      // ------------------------------------------------------
      // Comments
      // ------------------------------------------------------

      if (trimmed.startsWith('#')) {
        return line;
      }


      // ------------------------------------------------------
      // HLS MEDIA / SUB PLAYLIST URI
      // ------------------------------------------------------

      try {

        const absolute =
          new URL(
            trimmed,
            playlistUrl
          ).href;

        rewrittenCount++;

        return (
          origin +
          '/proxy/' +
          encodeURIComponent(absolute)
        );

      } catch (e) {

        console.error(
          'MEDIA URL REWRITE ERROR:',
          trimmed,
          e.message
        );

        return line;
      }

    });


  console.log(
    'PLAYLIST URLS REWRITTEN:',
    rewrittenCount
  );

  return output.join('\n');
}


// ============================================================
// PROXY CONTENT
// ============================================================

async function proxyContent(
  request,
  targetUrl
) {

  let parsed;

  try {

    parsed = new URL(targetUrl);

  } catch (error) {

    console.error(
      'INVALID TARGET URL:',
      targetUrl
    );

    return textResponse(
      'Invalid target URL',
      400
    );
  }


  console.log('----------------------------------------');
  console.log('MEDIA REQUEST');
  console.log('Target:', targetUrl);
  console.log('Type:', request.method);


  const headers = {
    'User-Agent': CONFIG.userAgent,
    'Cookie': CONFIG.cookie,
    'Accept': '*/*'
  };


  const range =
    request.headers.get('Range');

  if (range) {

    headers['Range'] = range;

    console.log(
      'Range:',
      range
    );
  }


  const referer =
    request.headers.get('Referer');

  if (referer) {

    console.log(
      'Client Referer:',
      referer
    );
  }


  let response;

  const started = Date.now();

  try {

    response = await fetch(
      parsed.href,
      {
        method: request.method,
        headers,
        redirect: 'follow'
      }
    );

  } catch (error) {

    console.error(
      'MEDIA FETCH ERROR:',
      error
    );

    return new Response(
      JSON.stringify({
        error: 'Upstream media fetch failed',
        message: error.message,
        target: parsed.href
      }, null, 2),
      {
        status: 502,
        headers: {
          ...corsHeaders,
          'Content-Type':
            'application/json'
        }
      }
    );
  }


  const elapsed =
    Date.now() - started;


  console.log(
    'MEDIA STATUS:',
    response.status
  );

  console.log(
    'MEDIA CONTENT-TYPE:',
    response.headers.get(
      'content-type'
    )
  );

  console.log(
    'MEDIA CONTENT-LENGTH:',
    response.headers.get(
      'content-length'
    )
  );

  console.log(
    'MEDIA FINAL URL:',
    response.url
  );

  console.log(
    'MEDIA REDIRECTED:',
    response.redirected
  );

  console.log(
    'MEDIA TIME:',
    elapsed + 'ms'
  );


  const responseHeaders =
    new Headers(
      response.headers
    );


  // CORS
  Object.entries(
    corsHeaders
  ).forEach(
    ([key, value]) => {
      responseHeaders.set(
        key,
        value
      );
    }
  );


  // Do not cache live media
  responseHeaders.set(
    'Cache-Control',
    'no-store'
  );


  // Helpful fallback content types
  const contentType =
    responseHeaders.get(
      'content-type'
    ) || '';


  if (
    !contentType &&
    (
      parsed.pathname.endsWith('.ts') ||
      parsed.pathname.includes('.ts')
    )
  ) {

    responseHeaders.set(
      'Content-Type',
      'video/mp2t'
    );
  }


  if (
    parsed.pathname.endsWith('.m3u8') ||
    contentType.includes(
      'mpegurl'
    )
  ) {

    responseHeaders.set(
      'Content-Type',
      'application/vnd.apple.mpegurl'
    );
  }


  if (!response.ok) {

    console.error(
      'MEDIA REQUEST FAILED:',
      response.status,
      parsed.href
    );

    return new Response(
      JSON.stringify({
        error: 'Upstream media request failed',

        status: response.status,

        statusText:
          response.statusText,

        target: parsed.href,

        finalUrl:
          response.url,

        redirected:
          response.redirected,

        contentType:
          response.headers.get(
            'content-type'
          ),

        elapsedMs: elapsed

      }, null, 2),
      {
        status: response.status,
        headers: {
          ...corsHeaders,
          'Content-Type':
            'application/json'
        }
      }
    );
  }


  console.log(
    'MEDIA OK:',
    parsed.pathname
  );

  console.log('----------------------------------------');


  return new Response(
    response.body,
    {
      status: response.status,
      statusText:
        response.statusText,
      headers:
        responseHeaders
    }
  );
}


// ============================================================
// PLAYER PAGE
// ============================================================

function servePlayerPage(origin) {

  const html = `<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1.0"
>

<title>HLS Debug Player</title>

<script
  src="https://cdn.jsdelivr.net/npm/hls.js@latest">
</script>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #0f0f0f;
  color: white;
  font-family: Arial, sans-serif;
}

.container {
  width: 100%;
  max-width: 1100px;
  margin: auto;
  padding: 20px;
}

h1 {
  text-align: center;
  font-size: 22px;
}

.player {
  position: relative;
  width: 100%;
  padding-top: 56.25%;
  background: black;
  border-radius: 12px;
  overflow: hidden;
}

video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 15px;
}

button,
a {
  border: 0;
  border-radius: 8px;
  padding: 11px 16px;
  background: #2c3e50;
  color: white;
  text-decoration: none;
  cursor: pointer;
}

.status {
  margin-top: 15px;
  padding: 12px;
  border-radius: 8px;
  background: #222;
  word-break: break-word;
}

.log {
  margin-top: 15px;
  background: #080808;
  border-radius: 8px;
  padding: 15px;
  white-space: pre-wrap;
  font-family: monospace;
  font-size: 12px;
  max-height: 350px;
  overflow: auto;
}

</style>

</head>

<body>

<div class="container">

<h1>HLS Debug Player</h1>

<div class="player">

<video
  id="video"
  controls
  autoplay
  muted
  playsinline>
</video>

</div>

<div class="controls">

<button onclick="toggleMute()">
🔇 Mute / Unmute
</button>

<button onclick="fullscreen()">
⛶ Fullscreen
</button>

<a href="${origin}/playlist.m3u8">
📥 Playlist
</a>

<a href="${origin}/debug">
🔍 Debug
</a>

<a href="${origin}/test-upstream">
🧪 Upstream Test
</a>

</div>

<div
  id="status"
  class="status">
Connecting...
</div>

<div
  id="log"
  class="log">
Waiting for HLS events...
</div>

</div>


<script>

const video =
  document.getElementById('video');

const statusEl =
  document.getElementById('status');

const logEl =
  document.getElementById('log');

const videoSrc =
  '${origin}/playlist.m3u8';


function log(message) {

  console.log(message);

  logEl.textContent +=
    '\\n' + message;

  logEl.scrollTop =
    logEl.scrollHeight;
}


function status(message) {

  statusEl.textContent =
    message;
}


function toggleMute() {

  video.muted =
    !video.muted;
}


function fullscreen() {

  if (
    video.requestFullscreen
  ) {
    video.requestFullscreen();
  }
}


if (Hls.isSupported()) {

  log(
    'HLS.js supported'
  );

  const hls =
    new Hls({

      debug: true,

      enableWorker: true,

      lowLatencyMode: true,

      backBufferLength: 30,

      xhrSetup: function(
        xhr,
        url
      ) {

        log(
          'XHR → ' + url
        );
      }

    });


  hls.on(
    Hls.Events.MANIFEST_LOADING,
    function(event, data) {

      log(
        'MANIFEST_LOADING → ' +
        data.url
      );

      status(
        'Loading playlist...'
      );
    }
  );


  hls.on(
    Hls.Events.MANIFEST_LOADED,
    function(event, data) {

      log(
        'MANIFEST_LOADED'
      );

      log(
        'Manifest URL: ' +
        data.url
      );

      log(
        'Manifest size: ' +
        (
          data.networkDetails &&
          data.networkDetails.response
            ? data.networkDetails.response.length
            : 'unknown'
        )
      );
    }
  );


  hls.on(
    Hls.Events.MANIFEST_PARSED,
    function(event, data) {

      log(
        'MANIFEST_PARSED'
      );

      log(
        'Levels: ' +
        hls.levels.length
      );

      status(
        'Playlist loaded. Waiting for media...'
      );

      video.play()
        .then(function() {

          log(
            'video.play() succeeded'
          );

        })
        .catch(function(error) {

          log(
            'video.play() failed: ' +
            error.message
          );

        });
    }
  );


  hls.on(
    Hls.Events.FRAG_LOADING,
    function(event, data) {

      log(
        'FRAG_LOADING → ' +
        (
          data.frag &&
          data.frag.url
            ? data.frag.url
            : 'unknown'
        )
      );

    }
  );


  hls.on(
    Hls.Events.FRAG_LOADED,
    function(event, data) {

      log(
        'FRAG_LOADED'
      );

      status(
        'Media segment loaded ✓'
      );

    }
  );


  hls.on(
    Hls.Events.FRAG_BUFFERED,
    function() {

      log(
        'FRAG_BUFFERED'
      );

      status(
        'Stream playing ✓'
      );

    }
  );


  hls.on(
    Hls.Events.ERROR,
    function(event, data) {

      console.error(
        'FULL HLS ERROR:',
        data
      );


      log(
        '=============================='
      );

      log(
        'HLS ERROR'
      );

      log(
        'Type: ' +
        data.type
      );

      log(
        'Details: ' +
        data.details
      );

      log(
        'Fatal: ' +
        data.fatal
      );


      if (data.url) {

        log(
          'URL: ' +
          data.url
        );

      }


      if (
        data.response
      ) {

        log(
          'HTTP Status: ' +
          (
            data.response.code ||
            'unknown'
          )
        );

        log(
          'Response URL: ' +
          (
            data.response.url ||
            'unknown'
          )
        );

      }


      status(
        '✗ ' +
        data.type +
        ' / ' +
        data.details
      );


      log(
        '=============================='
      );


      if (
        data.fatal &&
        data.type ===
        Hls.ErrorTypes.NETWORK_ERROR
      ) {

        log(
          'Fatal network error detected.'
        );

      }


      if (
        data.fatal &&
        data.type ===
        Hls.ErrorTypes.MEDIA_ERROR
      ) {

        log(
          'Attempting media recovery...'
        );

        hls.recoverMediaError();

      }

    }
  );


  hls.attachMedia(video);

  hls.loadSource(videoSrc);


} else if (
  video.canPlayType(
    'application/vnd.apple.mpegurl'
  )
) {

  log(
    'Native HLS supported'
  );

  video.src =
    videoSrc;

  video.addEventListener(
    'loadedmetadata',
    function() {

      status(
        'Metadata loaded ✓'
      );

      video.play();

    }
  );


  video.addEventListener(
    'error',
    function() {

      log(
        'Native video error'
      );

      status(
        '✗ Native HLS error'
      );

    }
  );


} else {

  status(
    '✗ HLS not supported'
  );

  log(
    'Browser does not support HLS'
  );

}

</script>

</body>

</html>`;


  return new Response(
    html,
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type':
          'text/html; charset=UTF-8'
      }
    }
  );
}


// ============================================================
// HELPERS
// ============================================================

async function safeReadText(response) {

  try {

    return await response.text();

  } catch (error) {

    return (
      'Unable to read response: ' +
      error.message
    );
  }
}


function textResponse(
  message,
  status = 200
) {

  return new Response(
    message,
    {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type':
          'text/plain; charset=UTF-8'
      }
    }
  );
}
