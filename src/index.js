/**
 * Jamuna TV Reverse Proxy
 * Cloudflare Worker Script
 */

// Configuration
const CONFIG = {
  // Base URL for the stream (without playlist.m3u8)
  baseUrl: 'https://bldcmprod-cdn.toffeelive.com/cdn/live/jamuna_tv',
  // Authentication cookie
  cookie: 'Edge-Cache-Cookie=URLPrefix=aHR0cHM6Ly9ibGRjbXByb2QtY2RuLnRvZmZlZWxpdmUuY29t:Expires=1790009400:KeyName=prod_linear:Signature=xMljSvmCVtgmO_vZGPxckgUbFKrfJwU6G6xLvINarudszkYcVYS1VzrOpnICdQCARYlpOML5YN95R1_BRJiQDg',
  // User agent
  userAgent: 'okhttp/4.11.0',
  // Logo URL (optional, for reference)
  logo: 'https://assets-prod.services.toffeelive.com/w_640,q_75,f_webp/PiL635oBEef-9-uV2uCe/posters/36f380e0-6c71-4b27-a73b-2afb3ce7e982.png'
};

// CORS headers to allow playback from any origin
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route: /playlist.m3u8 - Main playlist
      if (path === '/playlist.m3u8' || path === '/') {
        return await fetchPlaylist(request, CONFIG.baseUrl + '/playlist.m3u8', url.origin);
      }
      
      // Route: /proxy/* - Proxy any URL (for segments and sub-playlists)
      if (path.startsWith('/proxy/')) {
        const targetUrl = decodeURIComponent(path.replace('/proxy/', ''));
        return await proxyContent(request, targetUrl);
      }

      // Route: /segments/* - Handle segment requests
      if (path.startsWith('/segments/')) {
        const segmentPath = path.replace('/segments/', '');
        const targetUrl = CONFIG.baseUrl + '/' + segmentPath;
        return await proxyContent(request, targetUrl);
      }

      // Default: serve a simple player page
      return servePlayerPage(url.origin);

    } catch (error) {
      return new Response(`Error: ${error.message}`, { 
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain'
        }
      });
    }
  }
};

/**
 * Fetch and rewrite the m3u8 playlist
 */
async function fetchPlaylist(request, targetUrl, origin) {
  const headers = {
    'User-Agent': CONFIG.userAgent,
    'Cookie': CONFIG.cookie,
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
  };

  const response = await fetch(targetUrl, {
    method: 'GET',
    headers: headers,
    redirect: 'follow',
  });

  if (!response.ok) {
    return new Response(`Failed to fetch playlist: ${response.status}`, {
      status: response.status,
      headers: corsHeaders,
    });
  }

  let body = await response.text();
  
  // Rewrite URLs in the playlist to go through our proxy
  // Match URLs that start with http or are relative paths
  body = rewritePlaylistUrls(body, origin);

  return new Response(body, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * Rewrite URLs in the m3u8 playlist to proxy through our worker
 */
function rewritePlaylistUrls(playlistContent, origin) {
  // Pattern 1: Full URLs (http:// or https://)
  let rewritten = playlistContent.replace(
    /(https?:\/\/[^\s]+)/g,
    (match) => {
      // Don't rewrite if it's already a data URI or our own domain
      if (match.includes(origin)) return match;
      // Proxy the URL
      return `${origin}/proxy/${encodeURIComponent(match)}`;
    }
  );

  // Pattern 2: Relative paths (segments, sub-playlists)
  const lines = rewritten.split('\n');
  const result = lines.map(line => {
    line = line.trim();
    
    // Skip comments and empty lines
    if (!line || line.startsWith('#')) return line;
    
    // If it's a relative path, convert to absolute and proxy
    if (!line.startsWith('http')) {
      const baseUrl = CONFIG.baseUrl;
      const fullUrl = line.startsWith('/') 
        ? new URL(line, baseUrl).toString()
        : baseUrl + '/' + line;
      return `${origin}/proxy/${encodeURIComponent(fullUrl)}`;
    }
    
    return line;
  });

  return result.join('\n');
}

/**
 * Proxy video segments and other content
 */
async function proxyContent(request, targetUrl) {
  const headers = {
    'User-Agent': CONFIG.userAgent,
    'Cookie': CONFIG.cookie,
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Range': request.headers.get('Range') || '',
  };

  // Remove empty headers
  Object.keys(headers).forEach(key => {
    if (!headers[key]) delete headers[key];
  });

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: headers,
    redirect: 'follow',
  });

  // Create response with CORS headers
  const responseHeaders = new Headers(response.headers);
  
  // Add CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  // Ensure proper content-type for video segments
  const contentType = responseHeaders.get('content-type') || '';
  if (targetUrl.includes('.ts') && !contentType) {
    responseHeaders.set('Content-Type', 'video/mp2t');
  } else if (targetUrl.includes('.m3u8')) {
    responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

/**
 * Serve a simple HTML5 player page
 */
function servePlayerPage(origin) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jamuna TV - Live Stream</title>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f;
      color: #fff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .container {
      width: 100%;
      max-width: 1200px;
      padding: 20px;
    }
    .header {
      text-align: center;
      margin-bottom: 20px;
    }
    .header img {
      width: 120px;
      height: auto;
      margin-bottom: 15px;
    }
    .header h1 {
      font-size: 24px;
      font-weight: 600;
      color: #fff;
    }
    .player-wrapper {
      position: relative;
      width: 100%;
      padding-top: 56.25%; /* 16:9 aspect ratio */
      background: #000;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    #video {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .controls {
      margin-top: 20px;
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .btn {
      padding: 12px 24px;
      background: #e74c3c;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.3s ease;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn:hover {
      background: #c0392b;
      transform: translateY(-2px);
    }
    .btn.secondary {
      background: #2c3e50;
    }
    .btn.secondary:hover {
      background: #34495e;
    }
    .info {
      margin-top: 30px;
      padding: 20px;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      text-align: center;
    }
    .info code {
      background: rgba(0,0,0,0.3);
      padding: 2px 8px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 14px;
    }
    .status {
      margin-top: 15px;
      padding: 10px;
      border-radius: 6px;
      font-size: 14px;
    }
    .status.online {
      background: rgba(46, 204, 113, 0.2);
      color: #2ecc71;
    }
    .status.offline {
      background: rgba(231, 76, 60, 0.2);
      color: #e74c3c;
    }
    @media (max-width: 768px) {
      .header h1 { font-size: 20px; }
      .btn { padding: 10px 18px; font-size: 13px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${CONFIG.logo}" alt="Jamuna TV Logo" onerror="this.style.display='none'">
      <h1>Jamuna TV - Live Stream</h1>
    </div>
    
    <div class="player-wrapper">
      <video id="video" controls autoplay muted playsinline></video>
    </div>
    
    <div class="controls">
      <button class="btn" onclick="toggleMute()">
        <span id="mute-icon">🔇</span> <span id="mute-text">Unmute</span>
      </button>
      <button class="btn secondary" onclick="toggleFullscreen()">
        ⛶ Fullscreen
      </button>
      <a class="btn secondary" href="${origin}/playlist.m3u8" download>
        📥 Download M3U8
      </a>
    </div>
    
    <div class="info">
      <p>Direct Stream URL: <code>${origin}/playlist.m3u8</code></p>
      <div id="status" class="status offline">Connecting...</div>
    </div>
  </div>

  <script>
    const video = document.getElementById('video');
    const videoSrc = '${origin}/playlist.m3u8';
    const statusEl = document.getElementById('status');
    
    function updateStatus(online, message) {
      statusEl.className = 'status ' + (online ? 'online' : 'offline');
      statusEl.textContent = message;
    }
    
    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      
      hls.loadSource(videoSrc);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, function() {
        video.play();
        updateStatus(true, '✓ Connected - Stream Active');
      });
      
      hls.on(Hls.Events.ERROR, function(event, data) {
        console.error('HLS Error:', data);
        if (data.fatal) {
          updateStatus(false, '✗ Error: ' + data.type);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = videoSrc;
      video.addEventListener('loadedmetadata', function() {
        video.play();
        updateStatus(true, '✓ Connected - Stream Active');
      });
    } else {
      updateStatus(false, '✗ HLS not supported in this browser');
    }
    
    function toggleMute() {
      video.muted = !video.muted;
      document.getElementById('mute-icon').textContent = video.muted ? '🔇' : '🔊';
      document.getElementById('mute-text').textContent = video.muted ? 'Unmute' : 'Mute';
    }
    
    function toggleFullscreen() {
      if (video.requestFullscreen) {
        video.requestFullscreen();
      } else if (video.webkitRequestFullscreen) {
        video.webkitRequestFullscreen();
      } else if (video.msRequestFullscreen) {
        video.msRequestFullscreen();
      }
    }
    
    // Auto-unmute on user interaction
    document.addEventListener('click', function() {
      if (video.muted) {
        video.muted = false;
        document.getElementById('mute-icon').textContent = '🔊';
        document.getElementById('mute-text').textContent = 'Mute';
      }
    }, { once: true });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html',
    },
  });
}
