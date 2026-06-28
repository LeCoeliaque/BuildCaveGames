const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createDeck, cancelDuplicateClues, getScoreMessage } = require('./gameLogic');

// ── Static file server ──────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
  // Security: keep requests confined to this game's directory (no ../ escapes).
  const root = path.resolve(__dirname);
  if (!path.resolve(filePath).startsWith(root + path.sep) && path.resolve(filePath) !== root) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); }
    else { res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' }); res.end(data); }
  });
});

// ── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

const rooms = {};
// ws → { roomCode, playerId }
const clientMeta = new WeakMap();

// Disconnect grace period: playerId → timeout handle
// When a player disconnects we wait before removing them,
// so a page refresh can reconnect before they're dropped.
const disconnectTimers = {};
const RECONNECT_GRACE_MS = 8000;

function send(ws, type, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room) {
  room.players.forEach(p => {
    if (p.ws && p.ws.readyState === 1) {
      send(p.ws, 'room_update', { view: buildView(room, p.id) });
    }
  });
}

// ── Room helpers ─────────────────────────────────────────────────────────────
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function buildView(room, playerId) {
  const active = room.players[room.activePlayerIndex];
  const isActive = active && active.id === playerId;

  let cluesView = null;
  if (room.state === 'comparing') {
    cluesView = room.clues.map(c => ({
      playerName: room.players.find(p => p.id === c.playerId)?.name || '?',
      clue: isActive ? null : c.clue,
      cancelled: c.cancelled,
      isMe: c.playerId === playerId,
    }));
  } else if (room.state === 'guessing') {
    cluesView = room.clues
      .filter(c => !c.cancelled)
      .map(c => ({
        playerName: room.players.find(p => p.id === c.playerId)?.name || '?',
        clue: c.clue,
        cancelled: false,
        isMe: c.playerId === playerId,
      }));
  } else if (room.state === 'cluing') {
    cluesView = room.clues.map(c => ({
      playerName: room.players.find(p => p.id === c.playerId)?.name || '?',
      clue: c.playerId === playerId ? c.clue : null,
      submitted: !!c.clue,
      isMe: c.playerId === playerId,
    }));
  }

  return {
    roomCode: room.code,
    state: room.state,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.id === room.hostId,
      isActive: p.id === active?.id,
      connected: p.ws && p.ws.readyState === 1,
    })),
    me: { id: playerId, isHost: playerId === room.hostId, isActive },
    activePlayerName: active?.name,
    cardsLeft: room.deck.length - room.currentCardIndex,
    successCount: room.successCount,
    cardWords: (room.state === 'choosing' && !isActive) ? room.currentCard : null,
    mysteryWord: (room.currentCard && room.chosenWordIndex !== null && !isActive)
      ? room.currentCard[room.chosenWordIndex] : null,
    chosenWordIndex: room.chosenWordIndex,
    clues: cluesView,
    myClue: room.clues.find(c => c.playerId === playerId)?.clue || null,
    guess: (room.state === 'result' || room.state === 'gameover') ? room.guess : null,
    turnResult: room.turnResult,
    lastTurnSummary: room.lastTurnSummary,
    scoreMessage: room.state === 'gameover' ? getScoreMessage(room.successCount) : null,
  };
}

function startTurn(room) {
  room.currentCard = room.deck[room.currentCardIndex];
  room.chosenWordIndex = null;
  room.clues = [];
  room.guess = null;
  room.turnResult = null;
  room.lastTurnSummary = null;
  room.state = 'choosing';
}

function nextTurn(room) {
  room.currentCardIndex++;
  if (room.currentCardIndex >= room.deck.length) {
    room.state = 'gameover';
    broadcast(room);
    return;
  }
  room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
  startTurn(room);
  broadcast(room);
}

function removePlayer(roomCode, playerId) {
  const room = rooms[roomCode];
  if (!room) return;
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx === -1) return;
  room.players.splice(idx, 1);
  if (room.players.length === 0) { delete rooms[roomCode]; return; }
  if (room.hostId === playerId) room.hostId = room.players[0].id;
  if (room.activePlayerIndex >= room.players.length) room.activePlayerIndex = 0;
  // If a clue slot belonged to this player and we're cluing, check if all remaining submitted
  if (room.state === 'cluing') {
    room.clues = room.clues.filter(c => c.playerId !== playerId);
    if (room.clues.length > 0 && room.clues.every(c => c.clue)) {
      room.clues = cancelDuplicateClues(room.clues);
      room.state = 'comparing';
    }
  }
  broadcast(room);
}

// ── Message handlers ─────────────────────────────────────────────────────────
const handlers = {
  create_room({ ws, name }) {
    if (!name?.trim()) return;
    let code;
    do { code = makeCode(); } while (rooms[code]);
    const id = code + '_' + Date.now();
    rooms[code] = {
      code, hostId: id,
      players: [{ id, name: name.trim(), ws }],
      state: 'lobby', deck: [], currentCardIndex: 0,
      successCount: 0, activePlayerIndex: 0,
      currentCard: null, chosenWordIndex: null,
      clues: [], guess: null, turnResult: null, lastTurnSummary: null,
    };
    clientMeta.set(ws, { roomCode: code, playerId: id });
    send(ws, 'room_joined', { roomCode: code, playerId: id });
    broadcast(rooms[code]);
  },

  join_room({ ws, code, name }) {
    const room = rooms[code?.toUpperCase()];
    if (!room) { send(ws, 'error', { message: 'Room not found.' }); return; }
    if (room.state !== 'lobby') { send(ws, 'error', { message: 'Game already in progress.' }); return; }
    if (room.players.length >= 7) { send(ws, 'error', { message: 'Room is full (max 7 players).' }); return; }
    if (!name?.trim()) { send(ws, 'error', { message: 'Please enter your name.' }); return; }
    if (room.players.find(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      send(ws, 'error', { message: 'Name already taken in this room.' }); return;
    }
    const id = code.toUpperCase() + '_' + Date.now();
    room.players.push({ id, name: name.trim(), ws });
    clientMeta.set(ws, { roomCode: code.toUpperCase(), playerId: id });
    send(ws, 'room_joined', { roomCode: code.toUpperCase(), playerId: id });
    broadcast(room);
  },

  // Reconnect: client sends their saved playerId and roomCode
  reconnect({ ws, roomCode, playerId }) {
    const room = rooms[roomCode];
    if (!room) { send(ws, 'error', { message: 'Room no longer exists.' }); return; }
    const player = room.players.find(p => p.id === playerId);
    if (!player) { send(ws, 'error', { message: 'Player not found in room.' }); return; }

    // Cancel pending removal timer if any
    if (disconnectTimers[playerId]) {
      clearTimeout(disconnectTimers[playerId]);
      delete disconnectTimers[playerId];
    }

    // Reattach ws
    player.ws = ws;
    clientMeta.set(ws, { roomCode, playerId });
    send(ws, 'room_joined', { roomCode, playerId });
    // Send the current state back to just this player
    send(ws, 'room_update', { view: buildView(room, playerId) });
    // Let others know this player is back
    broadcast(room);
  },

  start_game({ ws, roomCode }) {
    const room = rooms[roomCode];
    const meta = clientMeta.get(ws);
    if (!room || room.hostId !== meta?.playerId) return;
    if (room.players.length < 2) { send(ws, 'error', { message: 'Need at least 2 players.' }); return; }
    room.deck = createDeck();
    room.currentCardIndex = 0;
    room.successCount = 0;
    room.activePlayerIndex = Math.floor(Math.random() * room.players.length);
    startTurn(room);
    broadcast(room);
  },

  choose_word({ ws, roomCode, wordIndex }) {
    const room = rooms[roomCode];
    const meta = clientMeta.get(ws);
    if (!room || room.state !== 'choosing') return;
    const active = room.players[room.activePlayerIndex];
    if (active.id !== meta?.playerId) return;
    if (wordIndex < 0 || wordIndex > 4) return;
    room.chosenWordIndex = wordIndex;
    const nonActive = room.players.filter(p => p.id !== active.id);
    const is3p = room.players.length === 3;
    room.clues = [];
    nonActive.forEach(p => {
      room.clues.push({ playerId: p.id, clue: null, cancelled: false });
      if (is3p) room.clues.push({ playerId: p.id, clue: null, cancelled: false, isSecond: true });
    });
    room.state = 'cluing';
    broadcast(room);
  },

  submit_clue({ ws, roomCode, clue, slotIndex }) {
    const room = rooms[roomCode];
    const meta = clientMeta.get(ws);
    if (!room || room.state !== 'cluing') return;
    const active = room.players[room.activePlayerIndex];
    if (meta?.playerId === active.id) return;
    const myClues = room.clues.filter(c => c.playerId === meta?.playerId);
    const slot = myClues[slotIndex || 0];
    if (!slot) return;
    const globalIdx = room.clues.indexOf(slot);
    room.clues[globalIdx].clue = clue?.trim() || null;
    if (room.clues.every(c => c.clue)) {
      room.clues = cancelDuplicateClues(room.clues);
      room.state = 'comparing';
    }
    broadcast(room);
  },

  toggle_cancel_clue({ ws, roomCode, clueIndex }) {
    const room = rooms[roomCode];
    const meta = clientMeta.get(ws);
    if (!room || room.state !== 'comparing') return;
    const active = room.players[room.activePlayerIndex];
    if (meta?.playerId === active.id) return;
    if (room.clues[clueIndex]) room.clues[clueIndex].cancelled = !room.clues[clueIndex].cancelled;
    broadcast(room);
  },

  reveal_clues({ ws, roomCode }) {
    const room = rooms[roomCode];
    const meta = clientMeta.get(ws);
    if (!room || room.state !== 'comparing') return;
    const active = room.players[room.activePlayerIndex];
    if (meta?.playerId === active.id) return;
    room.state = 'guessing';
    broadcast(room);
  },

  submit_guess({ ws, roomCode, guess, skip }) {
    const room = rooms[roomCode];
    const meta = clientMeta.get(ws);
    if (!room || room.state !== 'guessing') return;
    const active = room.players[room.activePlayerIndex];
    if (meta?.playerId !== active.id) return;
    const mysteryWord = room.currentCard[room.chosenWordIndex];
    if (skip) {
      room.guess = null; room.turnResult = 'skip';
      room.lastTurnSummary = { mysteryWord, result: 'skip', validClues: room.clues.filter(c => !c.cancelled).map(c => c.clue) };
    } else {
      room.guess = guess?.trim();
      const correct = room.guess?.toLowerCase() === mysteryWord?.toLowerCase();
      room.turnResult = correct ? 'success' : 'wrong';
      if (correct) room.successCount++;
      room.lastTurnSummary = { mysteryWord, guess: room.guess, result: room.turnResult, validClues: room.clues.filter(c => !c.cancelled).map(c => c.clue) };
    }
    room.state = 'result';
    broadcast(room);
  },

  next_turn({ ws, roomCode }) {
    const room = rooms[roomCode];
    if (!room || room.state !== 'result') return;
    nextTurn(room);
  },

  new_game({ ws, roomCode }) {
    const room = rooms[roomCode];
    const meta = clientMeta.get(ws);
    if (!room || room.hostId !== meta?.playerId) return;
    room.deck = createDeck();
    room.currentCardIndex = 0;
    room.successCount = 0;
    room.activePlayerIndex = Math.floor(Math.random() * room.players.length);
    startTurn(room);
    broadcast(room);
  },
};

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const handler = handlers[msg.type];
    if (handler) handler({ ws, ...msg });
  });

  ws.on('close', () => {
    const meta = clientMeta.get(ws);
    if (!meta) return;
    const { roomCode, playerId } = meta;
    // Grace period: give the client time to reconnect before removing them
    disconnectTimers[playerId] = setTimeout(() => {
      delete disconnectTimers[playerId];
      removePlayer(roomCode, playerId);
    }, RECONNECT_GRACE_MS);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🎲 Just One → http://localhost:${PORT}\n`));
