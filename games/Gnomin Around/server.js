'use strict';
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, makeCode }  = require('./game');

const PUBLIC = path.join(__dirname, '', '');
const MIME   = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.ico':'image/x-icon' };

const server = http.createServer((req, res) => {
  const filePath = path.join(PUBLIC, req.url === '/' ? 'index.html' : req.url);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

const wss     = new WebSocketServer({ server });
const games   = new Map();
const clients = new Map();

function uid() { return crypto.randomUUID(); }

function broadcastAll(game, msgFn) {
  for (const p of game.players) {
    if (!p.ws || p.ws.readyState !== 1) continue;
    const extra = msgFn(p.id);
    if (extra === null) continue;
    p.ws.send(JSON.stringify({ ...extra, state: game.publicState(p.id) }));
  }
}

function reply(ws, game, extra = {}) {
  if (ws.readyState !== 1) return;
  const pid = clients.get(ws)?.playerId;
  ws.send(JSON.stringify({ ...extra, state: game?.publicState(pid) ?? null }));
}

function replyErr(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', msg }));
}

wss.on('connection', (ws) => {
  clients.set(ws, { playerId: null, gameId: null });

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const info   = clients.get(ws);
    const game   = info.gameId ? games.get(info.gameId) : null;
    const player = game?.player(info.playerId);

    switch (msg.type) {

      case 'reconnect': {
        const g = games.get(msg.gameId?.toUpperCase?.());
        if (!g) { replyErr(ws, 'Game no longer exists'); break; }
        const p = g.player(msg.playerId);
        if (!p) { replyErr(ws, 'Player not found in game'); break; }
        // Reattach this socket to the existing player slot.
        clearTimeout(g._cleanupTimer);
        p.ws = ws;
        clients.set(ws, { playerId: p.id, gameId: g.id });
        const isHost = g.players[0]?.id === p.id;
        reply(ws, g, { type: 'reconnected', gameId: g.id, playerId: p.id, isHost });
        broadcastAll(g, pid => pid !== p.id ? { type: 'player_rejoined', name: p.name } : null);
        break;
      }

      case 'create_game': {
        const gameId   = makeCode();
        const playerId = uid();
        const name     = san(msg.name) || 'Gnome';
        const rules    = parseRules(msg.rules);
        const g        = new Game(gameId, rules);
        g.addPlayer(playerId, name, ws);
        games.set(gameId, g);
        clients.set(ws, { playerId, gameId });
        reply(ws, g, { type: 'created', gameId, playerId, isHost: true });
        break;
      }

      case 'join_game': {
        const g = games.get(msg.gameId?.toUpperCase?.());
        if (!g)                  { replyErr(ws, 'Game not found');     break; }
        if (g.state !== 'lobby') { replyErr(ws, 'Game already started'); break; }
        const playerId = uid();
        const name     = san(msg.name) || 'Gnome';
        if (!g.addPlayer(playerId, name, ws)) { replyErr(ws, 'Game is full'); break; }
        clients.set(ws, { playerId, gameId: g.id });
        reply(ws, g, { type: 'joined', gameId: g.id, playerId, isHost: false });
        broadcastAll(g, pid => pid !== playerId ? { type: 'lobby_update' } : null);
        break;
      }

      case 'start_game': {
        if (!game || !player) break;
        if (game.players[0].id !== player.id) { replyErr(ws, 'Only host can start'); break; }
        const r = game.startGame();
        if (!r.ok) { replyErr(ws, r.error); break; }
        broadcastAll(game, () => ({ type: 'game_started' }));
        break;
      }

      case 'draw_deck': {
        if (!game || !player) break;
        const r = game.drawDeck(player.id);
        if (!r.ok) { replyErr(ws, r.error); break; }
        reply(ws, game, { type: 'drew', card: r.card });
        broadcastAll(game, pid => pid !== player.id ? { type: 'state_update' } : null);
        break;
      }

      case 'draw_discard': {
        if (!game || !player) break;
        const r = game.drawDiscard(player.id, msg.pileIdx);
        if (!r.ok) { replyErr(ws, r.error); break; }
        reply(ws, game, { type: 'drew', card: r.card });
        broadcastAll(game, pid => pid !== player.id ? { type: 'state_update' } : null);
        break;
      }

      case 'place_card': {
        if (!game || !player) break;
        const r = game.placeCard(player.id, msg.gridIdx, msg.mulliganValue);
        if (!r.ok) { replyErr(ws, r.error); break; }
        reply(ws, game, { type: 'placed', displaced: r.displaced, bounceCard: r.bounceCard, lastFlipped: r.lastFlipped });
        broadcastAll(game, pid => pid !== player.id ? { type: 'state_update' } : null);
        break;
      }

      case 'bounce_card': {
        if (!game || !player) break;
        const r = game.executeBounce(player.id, msg.gridIdx);
        if (!r.ok) { replyErr(ws, r.error); break; }
        reply(ws, game, { type: 'bounced', displaced: r.displaced, nextBounce: r.nextBounce, lastFlipped: r.lastFlipped });
        broadcastAll(game, pid => pid !== player.id ? { type: 'state_update' } : null);
        break;
      }

      case 'discard_drawn': {
        if (!game || !player) break;
        const r = game.discardDrawn(player.id, msg.pileIdx);
        if (!r.ok) { replyErr(ws, r.error); break; }
        afterDiscard(ws, game, player, r);
        break;
      }

      case 'discard_displaced': {
        if (!game || !player || !msg.card) { replyErr(ws, 'Missing data'); break; }
        const r = game.discardCard(player.id, msg.card, msg.pileIdx);
        if (!r.ok) { replyErr(ws, r.error); break; }
        if (msg.lastFlipped) game.triggerRoundEnd(player.id);
        afterDiscard(ws, game, player, r);
        break;
      }

      case 'flip_hazard': {
        if (!game || !player) break;
        const r = game.flipHazard(player.id, msg.gridIdx);
        if (!r.ok) { replyErr(ws, r.error); break; }
        broadcastAll(game, () => ({ type: 'state_update' }));
        break;
      }

      case 'next_round': {
        if (!game || !player) break;
        if (game.players[0].id !== player.id) break;
        const r = game.nextRound();
        if (!r.ok) { replyErr(ws, r.error); break; }
        broadcastAll(game, () => ({ type: 'round_started' }));
        break;
      }

      case 'get_state': {
        if (game) reply(ws, game, { type: 'state_update' });
        break;
      }
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info?.gameId) {
      const g = games.get(info.gameId);
      if (g) {
        const p = g.player(info.playerId);
        if (p) { p.ws = null; broadcastAll(g, () => ({ type: 'player_left', name: p.name })); }
        // Lobby: if everyone's gone, delete immediately.
        if (g.state === 'lobby' && g.players.every(p => !p.ws || p.ws.readyState !== 1)) {
          games.delete(info.gameId);
        }
        // Mid-game: if all players are disconnected, hold the room for 5 min, then clean up.
        else if (g.players.every(p => !p.ws || p.ws.readyState !== 1)) {
          clearTimeout(g._cleanupTimer);
          g._cleanupTimer = setTimeout(() => {
            const cur = games.get(info.gameId);
            if (cur && cur.players.every(p => !p.ws || p.ws.readyState !== 1)) {
              games.delete(info.gameId);
              console.log(`[gnomin] cleaned up abandoned game ${info.gameId}`);
            }
          }, 5 * 60 * 1000);
        }
      }
    }
    clients.delete(ws);
  });
});

function afterDiscard(ws, game, player, r) {
  if (r.hazard) broadcastAll(game, () => ({ type: 'hazard_event', owed: r.owed }));
  else          broadcastAll(game, () => ({ type: 'state_update' }));
}

function san(str)  { return String(str||'').replace(/[<>"]/g,'').trim().slice(0,20); }
function parseRules(r={}) {
  return {
    advancedBounce:   !!r.advancedBounce,
    runs:             !!r.runs,
    advancedHazard:   !!r.advancedHazard,
    advancedMulligan: !!r.advancedMulligan,
    totalRounds:      Math.max(1, Math.min(9, parseInt(r.totalRounds)||3)),
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🍄 Gnome Golf → http://localhost:${PORT}`));
