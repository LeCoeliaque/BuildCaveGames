const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TARGET_SCORE = 20;

// Word cards - blank can be before (_) or after the word
const CARDS = [
  { word: 'TOWN', blank: 'before' },
  { word: 'FIRE', blank: 'after' },
  { word: 'BOOK', blank: 'before' },
  { word: 'BOOK', blank: 'after' },
  { word: 'HOUSE', blank: 'before' },
  { word: 'HOUSE', blank: 'after' },
  { word: 'LIGHT', blank: 'before' },
  { word: 'LIGHT', blank: 'after' },
  { word: 'SIDE', blank: 'before' },
  { word: 'SIDE', blank: 'after' },
  { word: 'BACK', blank: 'before' },
  { word: 'BACK', blank: 'after' },
  { word: 'BALL', blank: 'before' },
  { word: 'WATER', blank: 'before' },
  { word: 'WATER', blank: 'after' },
  { word: 'DAY', blank: 'before' },
  { word: 'DAY', blank: 'after' },
  { word: 'HAND', blank: 'before' },
  { word: 'HAND', blank: 'after' },
  { word: 'UNDER', blank: 'after' },
  { word: 'OVER', blank: 'after' },
  { word: 'OUT', blank: 'after' },
  { word: 'DOWN', blank: 'before' },
  { word: 'DOWN', blank: 'after' },
  { word: 'UP', blank: 'before' },
  { word: 'UP', blank: 'after' },
  { word: 'GROUND', blank: 'before' },
  { word: 'DOOR', blank: 'before' },
  { word: 'DOOR', blank: 'after' },
  { word: 'WAY', blank: 'before' },
  { word: 'WORK', blank: 'before' },
  { word: 'WORK', blank: 'after' },
  { word: 'MAN', blank: 'before' },
  { word: 'NIGHT', blank: 'before' },
  { word: 'NIGHT', blank: 'after' },
  { word: 'STONE', blank: 'before' },
  { word: 'STONE', blank: 'after' },
  { word: 'LINE', blank: 'before' },
  { word: 'LINE', blank: 'after' },
  { word: 'ROAD', blank: 'before' },
  { word: 'SHIP', blank: 'before' },
  { word: 'STAR', blank: 'before' },
  { word: 'SUN', blank: 'after' },
  { word: 'TIME', blank: 'before' },
  { word: 'TIME', blank: 'after' },
  { word: 'POWER', blank: 'before' },
  { word: 'FIELD', blank: 'before' },
  { word: 'FIELD', blank: 'after' },
  { word: 'POINT', blank: 'before' },
  { word: 'BRIDGE', blank: 'before' },
];

// Game state
let rooms = {};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createRoom(roomCode) {
  return {
    code: roomCode,
    players: {},
    state: 'lobby', // lobby | answering | reveal | gameover
    cards: shuffle(CARDS),
    cardIndex: 0,
    currentCard: null,
    answers: {},
    scores: {},
    roundResults: null,
    hostId: null,
    timer: null,
    timeLeft: 0,
  };
}

function broadcast(room, message) {
  Object.values(room.players).forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify(message));
    }
  });
}

function sendToPlayer(player, message) {
  if (player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(message));
  }
}

function getRoomState(room) {
  return {
    type: 'state',
    state: room.state,
    players: Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      score: room.scores[p.id] || 0,
      isHost: p.id === room.hostId,
      hasAnswered: room.answers[p.id] !== undefined,
    })),
    currentCard: room.currentCard,
    roundResults: room.roundResults,
    timeLeft: room.timeLeft,
  };
}

function startRound(room) {
  if (room.cardIndex >= room.cards.length) {
    room.cards = shuffle(CARDS);
    room.cardIndex = 0;
  }

  room.currentCard = room.cards[room.cardIndex++];
  room.answers = {};
  room.roundResults = null;
  room.state = 'answering';
  room.timeLeft = 30;

  broadcast(room, getRoomState(room));

  if (room.timer) clearInterval(room.timer);
  room.timer = setInterval(() => {
    room.timeLeft--;
    broadcast(room, { type: 'tick', timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      room.timer = null;
      revealAnswers(room);
    }
  }, 1000);
}

function checkAllAnswered(room) {
  const playerIds = Object.keys(room.players);
  const answeredIds = Object.keys(room.answers);
  return playerIds.length > 0 && playerIds.every(id => answeredIds.includes(id));
}

function revealAnswers(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  room.state = 'reveal';

  // Group answers
  const answerGroups = {};
  Object.entries(room.answers).forEach(([playerId, answer]) => {
    const key = answer.toUpperCase().trim();
    if (!answerGroups[key]) answerGroups[key] = [];
    answerGroups[key].push(playerId);
  });

  // Score
  const roundPoints = {};
  Object.keys(room.players).forEach(id => { roundPoints[id] = 0; });

  Object.entries(answerGroups).forEach(([answer, playerIds]) => {
    if (playerIds.length === 1) {
      // Only one person — 0 points
    } else if (playerIds.length === 2) {
      // Exactly one other match — 3 points each
      playerIds.forEach(id => { roundPoints[id] = 3; });
    } else {
      // Multiple matches — 1 point each
      playerIds.forEach(id => { roundPoints[id] = 1; });
    }
  });

  // Apply scores
  Object.entries(roundPoints).forEach(([id, pts]) => {
    if (!room.scores[id]) room.scores[id] = 0;
    room.scores[id] += pts;
  });

  // Build results with player names
  const results = Object.entries(room.answers).map(([playerId, answer]) => ({
    playerId,
    playerName: room.players[playerId]?.name || 'Unknown',
    answer: answer.toUpperCase().trim(),
    points: roundPoints[playerId] || 0,
  }));

  room.roundResults = results;

  // Check for winner
  const winner = Object.entries(room.scores).find(([id, score]) => score >= TARGET_SCORE);
  if (winner) {
    room.state = 'gameover';
    room.roundResults = results;
    broadcast(room, {
      ...getRoomState(room),
      winnerId: winner[0],
      winnerName: room.players[winner[0]]?.name,
    });
  } else {
    broadcast(room, getRoomState(room));
  }
}

// HTTP server to serve the client HTML
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let playerId = null;
  let roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      roomCode = msg.roomCode.toUpperCase().trim();
      playerId = msg.playerId || Math.random().toString(36).slice(2, 8);
      const name = (msg.name || 'Player').trim().slice(0, 16);

      if (!rooms[roomCode]) {
        rooms[roomCode] = createRoom(roomCode);
      }
      const room = rooms[roomCode];

      const isReturning = !!room.players[playerId] || room.scores[playerId] !== undefined;

      // A new player can only join during the lobby. A returning player
      // (same playerId, e.g. after a refresh) may reconnect any time.
      if (room.state !== 'lobby' && !isReturning) {
        sendToPlayer({ ws }, { type: 'error', message: 'Game already in progress.' });
        return;
      }

      if (Object.keys(room.players).length === 0) {
        room.hostId = playerId;
      }

      room.players[playerId] = { id: playerId, name, ws };
      room.scores[playerId] = room.scores[playerId] || 0;

      sendToPlayer({ ws }, { type: 'joined', playerId, roomCode });
      broadcast(room, getRoomState(room));
      return;
    }

    const room = rooms[roomCode];
    if (!room || !playerId) return;

    if (msg.type === 'start') {
      if (playerId !== room.hostId) return;
      if (Object.keys(room.players).length < 2) {
        sendToPlayer({ ws }, { type: 'error', message: 'Need at least 2 players to start.' });
        return;
      }
      startRound(room);
    }

    if (msg.type === 'answer') {
      if (room.state !== 'answering') return;
      const answer = (msg.answer || '').trim();
      if (!answer) return;
      room.answers[playerId] = answer;

      // Tell everyone who has answered (not what)
      broadcast(room, getRoomState(room));

      if (checkAllAnswered(room)) {
        revealAnswers(room);
      }
    }

    if (msg.type === 'nextRound') {
      if (playerId !== room.hostId) return;
      if (room.state !== 'reveal') return;
      startRound(room);
    }

    if (msg.type === 'resetGame') {
      if (playerId !== room.hostId) return;
      Object.keys(room.scores).forEach(id => { room.scores[id] = 0; });
      room.state = 'lobby';
      room.answers = {};
      room.roundResults = null;
      room.currentCard = null;
      if (room.timer) { clearInterval(room.timer); room.timer = null; }
      broadcast(room, getRoomState(room));
    }
  });

  ws.on('close', () => {
    if (!roomCode || !playerId || !rooms[roomCode]) return;
    const room = rooms[roomCode];
    delete room.players[playerId];

    // If host left, assign new host
    const remaining = Object.keys(room.players);
    if (remaining.length === 0) {
      if (room.timer) clearInterval(room.timer);
      delete rooms[roomCode];
      return;
    }
    if (room.hostId === playerId) {
      room.hostId = remaining[0];
    }
    broadcast(room, getRoomState(room));
  });
});

server.listen(PORT, () => {
  console.log(`\n🎮 Compound! server running`);
  console.log(`   Open http://localhost:${PORT} in your browser`);
  console.log(`   Share your local IP address for others to join on your network\n`);
});
