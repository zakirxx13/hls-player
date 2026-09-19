const CDN_HOST = "bldcmprod-cdn.toffeelive.com";
const CDN_UA = "okhttp/4.11.0";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors()
      });
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: cors()
      });
    }

    /*
     * Health check
     *
     * https://YOUR-WORKER.workers.dev/health
     */
    if (url.pathname === "/health") {
      return json({
        ok: true,
        worker: "online",
        upstream: CDN_HOST,
        time: new Date().toISOString()
      });
    }

    /*
     * Stream request
     *
     * /cdn/live/somoy_tv/playlist.m3u8
     *
     * /proxy/cdn/live/somoy_tv/segment.ts
     */

    let pathname = url.pathname;

    if (pathname.startsWith("/proxy/")) {
      pathname = pathname.substring("/proxy".length);
    }

    /*
     * Only allow the intended CDN path.
     */
    if (!pathname.startsWith("/cdn/live/")) {
      return new Response("Not Found", {
        status: 404,
        headers: cors()
      });
    }

    const targetUrl =
      `https://${CDN_HOST}${pathname}${url.search}`;

    const upstreamHeaders = new Headers();

    upstreamHeaders.set(
      "User-Agent",
      CDN_UA
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
     * Cookie lives in Cloudflare Secret.
     *
     * Secret name:
     * EDGE_CACHE_COOKIE
     */
    if (env.EDGE_CACHE_COOKIE) {
      upstreamHeaders.set(
        "Cookie",
        env.EDGE_CACHE_COOKIE
      );
    }

    /*
     * Support HLS byte-range requests.
     */
    const range =
      request.headers.get("Range");

    if (range) {
      upstreamHeaders.set(
        "Range",
        range
      );
    }

    let upstream;

    try {
      upstream = await fetch(
        targetUrl,
        {
          method: request.method,
          headers: upstreamHeaders,
          redirect: "follow"
        }
      );

    } catch (error) {

      return json({
        ok: false,
        error: "UPSTREAM_FETCH_FAILED",
        target: targetUrl,
        message: String(error)
      }, 502);
    }

    const contentType =
      upstream.headers.get("Content-Type") || "";

    const isM3U8 =
      pathname.endsWith(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("vnd.apple.mpegurl");

    /*
     * Playlist
     */
    if (isM3U8) {

      const body =
        await upstream.text();

      const rewritten =
        rewritePlaylist(
          body,
          targetUrl
        );

      const headers =
        new Headers(upstream.headers);

      headers.set(
        "Content-Type",
        contentType ||
        "application/vnd.apple.mpegurl"
      );

      headers.set(
        "Cache-Control",
        "no-store"
      );

      headers.delete(
        "Set-Cookie"
      );

      addCors(headers);

      return new Response(
        rewritten,
        {
          status: upstream.status,
          statusText: upstream.statusText,
          headers
        }
      );
    }

    /*
     * HLS segments
     */
    const headers =
      new Headers(upstream.headers);

    headers.delete(
      "Set-Cookie"
    );

    addCors(headers);

    return new Response(
      upstream.body,
      {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
      }
    );
  }
};


/*
 * Rewrite HLS URLs
 */
function rewritePlaylist(
  body,
  currentUrl
) {
  return body
    .split(/\r?\n/)
    .map(line => {

      const trimmed =
        line.trim();

      if (!trimmed) {
        return line;
      }

      /*
       * HLS tags:
       *
       * #EXT-X-KEY:URI="..."
       * #EXT-X-MAP:URI="..."
       */
      if (trimmed.startsWith("#")) {

        return line.replace(
          /URI="([^"]+)"/g,
          (match, uri) => {

            return `URI="${proxyUrl(
              uri,
              currentUrl
            )}"`;
          }
        );
      }

      /*
       * Normal segment / playlist URL
       */
      return proxyUrl(
        trimmed,
        currentUrl
      );

    })
    .join("\n");
}


/*
 * Convert CDN URLs to Worker URLs
 */
function proxyUrl(
  resource,
  currentUrl
) {
  try {

    const absolute =
      new URL(
        resource,
        currentUrl
      );

    if (
      absolute.hostname !== CDN_HOST
    ) {
      return resource;
    }

    return `/proxy${absolute.pathname}${absolute.search}`;

  } catch {

    return resource;
  }
}


/*
 * CORS
 */
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers":
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
    "GET,HEAD,OPTIONS"
  );

  headers.set(
    "Access-Control-Allow-Headers",
    "*"
  );
}


/*
 * JSON response
 */
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
        ...cors()
      }
    }
  );
        }
