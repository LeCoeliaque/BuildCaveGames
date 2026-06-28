/**
 * Buildcave Netplay — standardized WebSocket connection + reconnection for all hub games.
 *
 * Drop-in for any game. Handles:
 *   - connecting (ws/wss auto-detected)
 *   - persistent identity in localStorage (survives refresh)
 *   - auto-reconnect on accidental drop, with a visible banner
 *   - explicit leave (clears the saved session)
 *
 * Message contract every game server should follow:
 *   client → server:  { type:'join', room, playerId, name }      // join OR reconnect (same shape)
 *   server → client:  { type:'joined', playerId, room, reconnected:true|false }
 *   server → client:  { type:'error', message, fatal:true|false } // fatal clears the session
 *
 * Usage:
 *   const net = Netplay({
 *     game: 'triviawheel',                  // unique key — namespaces the saved session
 *     onMessage: (msg) => { ... },          // every parsed message
 *     onStatus:  (status) => { ... },       // 'connecting'|'open'|'reconnecting'|'closed'
 *   });
 *   net.join(room, name);                   // first join (from a button)
 *   net.send({ type:'roll' });              // send anything; queued if socket not open yet
 *   net.leave();                            // explicit leave; clears session + reloads
 *   net.tryAutoReconnect();                 // call on page load to resume a saved game
 */
function Netplay(opts) {
  const game = opts.game || 'game';
  const KEY = `bc_${game}_session`;
  const onMessage = opts.onMessage || (() => {});
  const onStatus  = opts.onStatus  || (() => {});

  let ws = null;
  let playerId = null;
  let room = null;
  let name = null;
  let intentionalClose = false;
  let reconnectTimer = null;
  let retries = 0;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ playerId, room, name }));
    } catch (e) {}
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    playerId = room = name = null;
  }

  function ensureId() {
    if (!playerId) {
      playerId = (Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
    }
    return playerId;
  }

  function connect(onOpen) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    onStatus('connecting');
    ws.onopen = () => { retries = 0; onStatus('open'); if (onOpen) onOpen(); };
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
      // Intercept the standard envelope, then pass everything through.
      if (msg.type === 'joined') {
        playerId = msg.playerId || playerId;
        room = msg.room || msg.roomCode || room;
        save();
        hideBanner();
      }
      if (msg.type === 'error' && msg.fatal) {
        clearSession();
        hideBanner();
      }
      onMessage(msg);
    };
    ws.onclose = () => {
      if (intentionalClose) { onStatus('closed'); return; }
      // Only auto-retry if we have a session to resume.
      if (room && playerId) {
        onStatus('reconnecting');
        showBanner(room);
        const delay = Math.min(1000 * Math.pow(1.5, retries++), 8000);
        reconnectTimer = setTimeout(() => connect(rejoin), delay);
      } else {
        onStatus('closed');
      }
    };
  }

  function rejoin() {
    send({ type: 'join', room, roomCode: room, playerId, name });
  }

  function join(roomCode, displayName) {
    room = String(roomCode || '').toUpperCase().trim();
    name = String(displayName || 'Player').trim().slice(0, 16);
    ensureId();
    save();
    intentionalClose = false;
    connect(() => send({ type: 'join', room, roomCode: room, playerId, name }));
  }

  function tryAutoReconnect() {
    const s = load();
    if (s && s.room && s.playerId) {
      playerId = s.playerId; room = s.room; name = s.name || 'Player';
      showBanner(room);
      intentionalClose = false;
      connect(rejoin);
      return true;
    }
    return false;
  }

  const queue = [];
  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      queue.push(msg);
    }
  }
  // Flush queue whenever the socket opens.
  const _connect = connect;
  connect = function (onOpen) {
    _connect(() => {
      if (onOpen) onOpen();
      while (queue.length && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(queue.shift()));
    });
  };

  function leave() {
    intentionalClose = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    clearSession();
    if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} }
    hideBanner();
    location.reload();
  }

  // ── Reconnect banner (injected, self-contained) ──
  let bannerEl = null;
  function ensureBanner() {
    if (bannerEl) return bannerEl;
    bannerEl = document.createElement('div');
    bannerEl.id = 'bc-reconn-banner';
    bannerEl.style.cssText =
      'display:none;position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'background:linear-gradient(90deg,#1e3a5f,#1e2a4a);color:#fff;' +
      'padding:.55rem 1rem;align-items:center;justify-content:center;gap:.6rem;' +
      'font-family:Outfit,system-ui,sans-serif;font-size:.82rem;' +
      'border-bottom:1px solid #60a5fa;box-shadow:0 2px 12px rgba(0,0,0,.4)';
    bannerEl.innerHTML =
      '<span class="bc-spin" style="width:13px;height:13px;border:2px solid rgba(255,255,255,.3);' +
      'border-top-color:#fff;border-radius:50%;display:inline-block;animation:bcspin .7s linear infinite"></span>' +
      '<span>Reconnecting to <strong class="bc-room">—</strong>…</span>' +
      '<button class="bc-cancel" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);' +
      'color:#fff;border-radius:6px;padding:.2rem .55rem;font-size:.72rem;cursor:pointer;font-family:inherit">Cancel</button>';
    const style = document.createElement('style');
    style.textContent = '@keyframes bcspin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
    document.body.appendChild(bannerEl);
    bannerEl.querySelector('.bc-cancel').addEventListener('click', leave);
    return bannerEl;
  }
  function showBanner(r) {
    const el = ensureBanner();
    el.querySelector('.bc-room').textContent = r || '';
    el.style.display = 'flex';
  }
  function hideBanner() {
    if (bannerEl) bannerEl.style.display = 'none';
  }

  return {
    join, leave, send, tryAutoReconnect,
    rejoin,
    get playerId() { return playerId; },
    get room() { return room; },
    get name() { return name; },
    get socket() { return ws; },
  };
}

if (typeof window !== 'undefined') window.Netplay = Netplay;
