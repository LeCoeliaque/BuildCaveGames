/**
 * Buildcave Game Hub
 *
 * Drop any game into ./games/<gamename>/server.js and it will appear on the hub.
 * Each game must read its port from process.env.PORT.
 * Customize game descriptions and images in ./games.config.json
 */

const http = require('http');
const net  = require('net');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const HUB_PORT       = process.env.PORT || 3000;
const GAMES_DIR      = path.join(__dirname, 'games');
const ASSETS_DIR     = path.join(__dirname, 'assets');
const CONFIG_PATH    = path.join(__dirname, 'games.config.json');
const BASE_GAME_PORT = 3100;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

// ── GAME CONFIG ───────────────────────────────────────────────────────────────

function loadGameConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('[hub] Could not load games.config.json:', e.message);
  }
  return {};
}

// ── GAME REGISTRY ─────────────────────────────────────────────────────────────

function discoverGames() {
  if (!fs.existsSync(GAMES_DIR)) {
    fs.mkdirSync(GAMES_DIR, { recursive: true });
    return [];
  }
  const config = loadGameConfig();
  return fs.readdirSync(GAMES_DIR)
    .filter(name => fs.existsSync(path.join(GAMES_DIR, name, 'server.js')))
    .map((name, i) => {
      const cfg = config[name] || {};
      return {
        name,
        slug:        name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        label:       name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: cfg.description || 'Click to play this game.',
        image:       cfg.image ? `/assets/games/${cfg.image}` : '',
        icon:        cfg.icon  || '🎮',
        dir:         path.join(GAMES_DIR, name),
        port:        BASE_GAME_PORT + i,
        process:     null,
        connections: 0,
        idleTimer:   null,
        starting:    false,
      };
    });
}

let GAMES = discoverGames();

function getGame(slug) {
  return GAMES.find(g => g.slug === slug);
}

// ── PROCESS MANAGEMENT ────────────────────────────────────────────────────────

function startGame(game) {
  return new Promise((resolve, reject) => {
    if (game.process) { resolve(); return; }
    if (game.starting) {
      const poll = setInterval(() => {
        if (!game.starting) { clearInterval(poll); resolve(); }
      }, 100);
      return;
    }

    game.starting = true;
    console.log(`[hub] Starting ${game.label} on port ${game.port}...`);

    const child = spawn('node', [path.join(game.dir, 'server.js')], {
      env: { ...process.env, PORT: String(game.port) },
      cwd: game.dir,
    });

    child.stdout.on('data', d => process.stdout.write(`[${game.slug}] ${d}`));
    child.stderr.on('data', d => process.stderr.write(`[${game.slug}] ${d}`));
    child.on('exit', (code) => {
      console.log(`[hub] ${game.label} exited (code ${code})`);
      game.process = null;
      game.starting = false;
    });

    game.process = child;

    const start = Date.now();
    const check = setInterval(() => {
      const sock = net.connect(game.port, '127.0.0.1');
      sock.on('connect', () => {
        sock.destroy(); clearInterval(check);
        game.starting = false;
        console.log(`[hub] ${game.label} ready`);
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - start > 10000) {
          clearInterval(check);
          game.starting = false;
          reject(new Error(`${game.label} failed to start in 10s`));
        }
      });
    }, 200);
  });
}

function stopGame(game) {
  if (!game.process) return;
  console.log(`[hub] Stopping ${game.label} (idle)`);
  game.process.kill();
  game.process = null;
}

function touchGame(game) {
  if (game.idleTimer) clearTimeout(game.idleTimer);
  game.idleTimer = setTimeout(() => {
    if (game.connections === 0) stopGame(game);
  }, IDLE_TIMEOUT_MS);
}

// ── PROXY ─────────────────────────────────────────────────────────────────────

function tunnel(src, dst) {
  src.pipe(dst); dst.pipe(src);
  src.on('error', () => dst.destroy());
  dst.on('error', () => src.destroy());
  src.on('close', () => dst.destroy());
  dst.on('close', () => src.destroy());
}

function wsPathPatch(slug) {
  return `<script>
(function(){
  var _WS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    try {
      var u = new URL(url);
      if (u.pathname === '/' || u.pathname === '') {
        u.pathname = '/${slug}/';
        url = u.toString();
      }
    } catch(e) {}
    return protocols !== undefined ? new _WS(url, protocols) : new _WS(url);
  };
  window.WebSocket.prototype = _WS.prototype;
  window.WebSocket.CONNECTING = _WS.CONNECTING;
  window.WebSocket.OPEN = _WS.OPEN;
  window.WebSocket.CLOSING = _WS.CLOSING;
  window.WebSocket.CLOSED = _WS.CLOSED;
})();
</script>`;
}

function hubNavBar(gameLabel) {
  return `
<style id="__hub-nav-style">
  #__hub-nav {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 99999;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: rgba(10, 14, 26, 0.92);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(34, 197, 94, 0.25);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    box-shadow: 0 2px 20px rgba(0,0,0,0.5);
  }
  #__hub-nav a {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #22c55e;
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid rgba(34, 197, 94, 0.3);
    background: rgba(34, 197, 94, 0.08);
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  #__hub-nav a:hover {
    background: rgba(34, 197, 94, 0.18);
    border-color: rgba(34, 197, 94, 0.6);
  }
  #__hub-nav .hub-game-label {
    color: #94a3b8;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  #__hub-nav img.__hub-logo {
    height: 26px;
    width: auto;
    margin-left: auto;
    opacity: 0.85;
  }
  body { padding-top: 43px !important; }
</style>
<div id="__hub-nav">
  <a href="/">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
    Hub
  </a>
  <span class="hub-game-label">${gameLabel}</span>
  <img class="__hub-logo" src="/assets/logo.png" alt="Buildcave" />
</div>`;
}

function proxyHTTP(req, res, game, rewrittenUrl) {
  const options = {
    hostname: '127.0.0.1',
    port: game.port,
    path: rewrittenUrl,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${game.port}` },
  };

  const proxy = http.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || '';
    const isHTML = contentType.includes('text/html');

    if (!isHTML) {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    const chunks = [];
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => {
      let html = Buffer.concat(chunks).toString('utf8');
      const wsPatch  = wsPathPatch(game.slug);
      const navBar   = hubNavBar(game.label);

      if (html.includes('</head>')) {
        html = html.replace('</head>', wsPatch + '</head>');
      } else {
        html = wsPatch + html;
      }
      if (html.includes('<body>')) {
        html = html.replace('<body>', '<body>' + navBar);
      } else if (html.includes('<body ')) {
        html = html.replace(/<body([^>]*)>/, (m) => m + navBar);
      } else {
        html = navBar + html;
      }

      const headers = { ...proxyRes.headers };
      delete headers['content-length'];
      headers['content-type'] = 'text/html; charset=utf-8';
      res.writeHead(proxyRes.statusCode, headers);
      res.end(html);
    });
  });

  proxy.on('error', (err) => {
    console.error(`[hub] Proxy error for ${game.slug}:`, err.message);
    if (!res.headersSent) { res.writeHead(502); res.end('Game unavailable.'); }
  });

  req.pipe(proxy);
}

// ── HTML ──────────────────────────────────────────────────────────────────────

function hubPage() {
  const config = loadGameConfig();

  const gameCards = GAMES.length === 0
    ? `<p class="empty">No games found. Add a game folder to <code>./games/</code>.</p>`
    : GAMES.map(g => {
        const imgHtml = g.image
          ? `<div class="card-img" style="background-image:url('${g.image}')"></div>`
          : `<div class="card-img card-img-placeholder"><span class="card-emoji">${g.icon}</span></div>`;

        return `
        <a class="card" href="/${g.slug}/">
          ${imgHtml}
          <div class="card-body">
            <div class="card-name">${g.label}</div>
            <div class="card-desc">${g.description}</div>
            <div class="card-cta">
              <span class="play-btn">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                Play Now
              </span>
            </div>
          </div>
        </a>`;
      }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Buildcave Game Hub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #080d16;
      --bg2:       #0c1220;
      --surface:   #111827;
      --surface2:  #1a2335;
      --border:    #1e2d42;
      --border2:   rgba(34, 197, 94, 0.2);
      --green:     #22c55e;
      --green-dim: #16a34a;
      --green-glow:rgba(34,197,94,0.15);
      --text:      #f1f5f9;
      --muted:     #64748b;
      --muted2:    #94a3b8;
    }

    html { scroll-behavior: smooth; }

    body {
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    /* ── BACKGROUND GRID ── */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(34,197,94,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(34,197,94,0.03) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
      z-index: 0;
    }

    /* ── GLOWS ── */
    body::after {
      content: '';
      position: fixed;
      top: -20%;
      left: 50%;
      transform: translateX(-50%);
      width: 800px;
      height: 500px;
      background: radial-gradient(ellipse, rgba(34,197,94,0.06) 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }

    /* ── NAV ── */
    nav {
      position: relative;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 32px;
      border-bottom: 1px solid var(--border);
      background: rgba(8, 13, 22, 0.8);
      backdrop-filter: blur(12px);
    }

    .nav-logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .nav-logo img {
      height: 40px;
      width: auto;
    }

    .nav-badge {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--green);
      background: var(--green-glow);
      border: 1px solid var(--border2);
      padding: 3px 10px;
      border-radius: 20px;
    }

    /* ── HERO ── */
    .hero {
      position: relative;
      z-index: 1;
      text-align: center;
      padding: 56px 24px 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .hero-logo {
      width: 110px;
      height: 110px;
      background: rgba(34,197,94,0.06);
      border: 1px solid rgba(34,197,94,0.18);
      border-radius: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 28px;
      position: relative;
    }

    .hero-logo::before {
      content: '';
      position: absolute;
      inset: -20px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(34,197,94,0.1) 0%, transparent 70%);
      pointer-events: none;
    }

    .hero-logo img {
      width: 80px;
      height: 80px;
      object-fit: contain;
    }

    .hero h1 {
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.05;
      color: var(--text);
      margin-bottom: 10px;
    }

    .hero p {
      color: var(--muted);
      font-size: 0.95rem;
      margin: 0;
    }

    .hero-divider {
      width: 40px;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--green), transparent);
      border-radius: 2px;
      margin-top: 20px;
    }

    /* ── SECTION LABEL ── */
    .section-label {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 32px;
      margin-bottom: 24px;
      max-width: 1100px;
      margin-left: auto;
      margin-right: auto;
    }

    .section-label span {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--muted);
      white-space: nowrap;
    }

    .section-label::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    /* ── GRID ── */
    .grid {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 32px;
    }

    /* ── CARD ── */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      text-decoration: none;
      color: inherit;
      overflow: hidden;
      transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
      display: flex;
      flex-direction: column;
    }

    .card:hover {
      transform: translateY(-6px);
      border-color: rgba(34, 197, 94, 0.4);
      box-shadow:
        0 0 0 1px rgba(34,197,94,0.1),
        0 16px 48px rgba(0,0,0,0.4),
        0 0 60px rgba(34,197,94,0.06);
    }

    .card:hover .play-btn {
      background: var(--green);
      color: #000;
    }

    .card-img {
      width: 100%;
      height: 160px;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
    }

    .card-img-placeholder {
      background: linear-gradient(135deg, var(--surface2) 0%, var(--bg2) 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
    }

    .card-img-placeholder::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 30% 50%, rgba(34,197,94,0.08) 0%, transparent 60%),
        linear-gradient(135deg, rgba(34,197,94,0.04) 0%, transparent 50%);
    }

    .card-emoji {
      font-size: 3rem;
      position: relative;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.5));
    }

    .card-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
    }

    .card-name {
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .card-desc {
      font-size: 0.82rem;
      color: var(--muted2);
      line-height: 1.55;
      flex: 1;
    }

    .card-cta {
      margin-top: 12px;
    }

    .play-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 7px 16px;
      border-radius: 6px;
      background: rgba(34, 197, 94, 0.12);
      color: var(--green);
      border: 1px solid rgba(34, 197, 94, 0.3);
      transition: background 0.15s, color 0.15s;
    }

    /* ── EMPTY ── */
    .empty {
      color: var(--muted);
      text-align: center;
      padding: 4rem;
      grid-column: 1 / -1;
      font-size: 0.95rem;
    }

    .empty code {
      background: var(--surface);
      padding: 0.15em 0.5em;
      border-radius: 4px;
      color: var(--green);
      font-size: 0.9em;
    }

    /* ── FOOTER ── */
    footer {
      position: relative;
      z-index: 1;
      margin-top: 72px;
      padding: 24px 32px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--muted);
      font-size: 12px;
    }

    footer .footer-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: var(--muted2);
    }

    footer .footer-brand img {
      height: 22px;
      opacity: 0.6;
    }

    @media (max-width: 640px) {
      nav { padding: 12px 16px; }
      .hero { padding: 40px 16px 32px; }
      .grid { padding: 0 16px; grid-template-columns: 1fr; }
      .section-label { padding: 0 16px; }
      footer { flex-direction: column; gap: 8px; text-align: center; }
    }
  </style>
</head>
<body>
  <nav>
    <div class="nav-logo">
      <img src="/assets/logo.png" alt="Buildcave" />
    </div>
    <span class="nav-badge">Game Hub</span>
  </nav>

  <div class="hero">
    <div class="hero-logo">
      <img src="/assets/logo.png" alt="Buildcave" />
    </div>
    <h1>Pick Your Game</h1>
    <p>Choose a game and start playing instantly.</p>
    <div class="hero-divider"></div>
  </div>

  <div class="section-label">
    <span>Available Games</span>
  </div>

  <div class="grid">
    ${gameCards}
  </div>

  <footer>
    <div class="footer-brand">
      <img src="/assets/logo.png" alt="Buildcave" />
      Buildcave — Applied Creative Engineering
    </div>
    <span>${GAMES.length} game${GAMES.length !== 1 ? 's' : ''} available</span>
  </footer>
</body>
</html>`;
}

function loadingPage(gameName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Starting ${gameName}...</title>
  <meta http-equiv="refresh" content="2">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #080d16;
      color: #f1f5f9;
      font-family: 'Inter', system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 20px;
    }
    img { height: 64px; opacity: 0.85; margin-bottom: 8px; }
    .spinner {
      width: 44px; height: 44px;
      border: 3px solid rgba(34,197,94,0.15);
      border-top-color: #22c55e;
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { font-size: 1.2rem; font-weight: 700; }
    p { color: #64748b; font-size: 0.85rem; }
    a { color: #22c55e; text-decoration: none; font-size: 0.85rem; margin-top: 8px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <img src="/assets/logo.png" alt="Buildcave" />
  <div class="spinner"></div>
  <h2>Starting ${gameName}…</h2>
  <p>This page will refresh automatically.</p>
  <a href="/">← Back to Hub</a>
</body>
</html>`;
}

// ── HTTP SERVER ───────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.wav':  'audio/wav',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const urlPath = req.url || '/';

  // Hub root
  if (urlPath === '/' || urlPath === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(hubPage());
    return;
  }

  // Static assets (/assets/...) — covers logo, assets/games/*, etc.
  if (urlPath.startsWith('/assets/')) {
    // Strip query string before resolving the file path
    const pathname = urlPath.split('?')[0];
    // Prevent directory traversal
    const rel = pathname.slice('/assets/'.length).replace(/\.\./g, '');
    const assetFile = path.join(ASSETS_DIR, rel);
    const ext  = path.extname(assetFile).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    if (fs.existsSync(assetFile) && fs.statSync(assetFile).isFile()) {
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
      fs.createReadStream(assetFile).pipe(res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // Match /<slug> or /<slug>/...
  const match = urlPath.match(/^\/([^/]+)(\/.*)?$/);
  if (!match) { res.writeHead(404); res.end('Not found'); return; }

  const slug = match[1];
  const rest = match[2] || '/';
  const game = getGame(slug);

  if (!game) { res.writeHead(404); res.end('Game not found'); return; }

  // Trailing slash redirect
  if (!match[2]) {
    res.writeHead(302, { Location: `/${slug}/` });
    res.end();
    return;
  }

  // Start game if not running
  if (!game.process) {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(loadingPage(game.label));
      await startGame(game);
    } catch (err) {
      console.error(err);
    }
    return;
  }

  touchGame(game);
  proxyHTTP(req, res, game, rest);
});

// ── WEBSOCKET UPGRADE ─────────────────────────────────────────────────────────

server.on('upgrade', async (req, socket, head) => {
  const urlPath = req.url || '/';
  const match = urlPath.match(/^\/([^/]+)(\/.*)?$/);

  if (!match) { socket.destroy(); return; }

  const slug = match[1];
  const rest = match[2] || '/';
  const game = getGame(slug);

  if (!game) { socket.destroy(); return; }

  if (!game.process) {
    try { await startGame(game); }
    catch (err) { socket.destroy(); return; }
  }

  game.connections++;
  touchGame(game);

  const upstream = net.connect(game.port, '127.0.0.1', () => {
    const headers = { ...req.headers, host: `127.0.0.1:${game.port}` };
    const headerLines = Object.entries(headers).map(([k,v]) => `${k}: ${v}`).join('\r\n');
    upstream.write(`${req.method} ${rest} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
    if (head && head.length) upstream.write(head);
    tunnel(socket, upstream);
  });

  upstream.on('error', () => {
    game.connections = Math.max(0, game.connections - 1);
    socket.destroy();
  });

  socket.on('close', () => {
    game.connections = Math.max(0, game.connections - 1);
  });
});

// ── START ─────────────────────────────────────────────────────────────────────

server.listen(HUB_PORT, () => {
  console.log(`\n🎮 Buildcave Game Hub → http://localhost:${HUB_PORT}`);
  console.log(`   Games: ${GAMES_DIR}`);
  if (GAMES.length === 0) {
    console.log(`   No games found.`);
  } else {
    GAMES.forEach(g => console.log(`   ✓ ${g.label} → /${g.slug}/`));
  }
  console.log();
});
