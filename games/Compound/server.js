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
   { word: 'CREAM', blank: 'after' },
  { word: 'WATER', blank: 'after' },
  { word: 'GOLDEN', blank: 'after' },
  { word: 'LIFE', blank: 'after' },
  { word: 'FOR', blank: 'after' },
  { word: 'MILK', blank: 'after' },
  { word: 'JUNGLE', blank: 'after' },
  { word: 'SECOND', blank: 'after' },
  { word: 'BIRTHDAY', blank: 'after' },
  { word: 'JUMP', blank: 'after' },
  { word: 'SPOT', blank: 'after' },
  { word: 'FACE', blank: 'after' },
  { word: 'PIT', blank: 'after' },
  { word: 'TREE', blank: 'after' },
  { word: 'FRONT', blank: 'after' },
  { word: 'SUPER', blank: 'after' },
  { word: 'FAT', blank: 'after' },
  { word: 'BED', blank: 'after' },
  { word: 'SMALL', blank: 'after' },
  { word: 'SOUTH', blank: 'after' },
  { word: 'HOLD', blank: 'after' },
  { word: 'TOP', blank: 'after' },
  { word: 'FLASH', blank: 'after' },
  { word: 'SAND', blank: 'after' },
  { word: 'REAL', blank: 'after' },
  { word: 'MOUTH', blank: 'after' },
  { word: 'NIGHT', blank: 'after' },
  { word: 'OPEN', blank: 'after' },
  { word: 'LIP', blank: 'after' },
  { word: 'MIXED', blank: 'after' },
  { word: 'POT', blank: 'after' },
  { word: 'PICNIC', blank: 'after' },
  { word: 'PILLOW', blank: 'after' },
  { word: 'COLD', blank: 'after' },
  { word: 'CASH', blank: 'after' },
  { word: 'NORTH', blank: 'after' },
  { word: 'BAKED', blank: 'after' },
  { word: 'MINI', blank: 'after' },
  { word: 'TOUGH', blank: 'after' },
  { word: 'SITTING', blank: 'after' },
  { word: 'HIGH', blank: 'after' },
  { word: 'FOOT', blank: 'after' },
  { word: 'DOOR', blank: 'after' },
  { word: 'JELLY', blank: 'after' },
  { word: 'JACK', blank: 'after' },
  { word: 'NAME', blank: 'after' },
  { word: 'LONG', blank: 'after' },
  { word: 'BODY', blank: 'after' },
  { word: 'FRESH', blank: 'after' },
  { word: 'STIFF', blank: 'after' },
  { word: 'PAY', blank: 'after' },
  { word: 'BANANA', blank: 'after' },
  { word: 'CHOCOLATE', blank: 'after' },
  { word: 'DRAW', blank: 'after' },
  { word: 'OFF', blank: 'after' },
  { word: 'MOTHER', blank: 'after' },
  { word: 'COFFEE', blank: 'after' },
  { word: 'PARKING', blank: 'after' },
  { word: 'MID', blank: 'after' },
  { word: 'THIRD', blank: 'after' },
  { word: 'RICE', blank: 'after' },
  { word: 'POP', blank: 'after' },
  { word: 'GAS', blank: 'after' },
  { word: 'BUSINESS', blank: 'after' },
  { word: 'HANG', blank: 'after' },
  { word: 'BOOK', blank: 'after' },
  { word: 'SHOPPING', blank: 'after' },
  { word: 'APPLE', blank: 'after' },
  { word: 'HARD', blank: 'after' },
  { word: 'GUEST', blank: 'after' },
  { word: 'BOWLING', blank: 'after' },
  { word: 'GET', blank: 'after' },
  { word: 'DEAD', blank: 'after' },
  { word: 'TEAM', blank: 'after' },
  { word: 'STRING', blank: 'after' },
  { word: 'BASE', blank: 'after' },
  { word: 'WORLD', blank: 'after' },
  { word: 'PLAY', blank: 'after' },
  { word: 'PRETTY', blank: 'after' },
  { word: 'FINE', blank: 'after' },
  { word: 'CHECK', blank: 'after' },
  { word: 'MASS', blank: 'after' },
  { word: 'COURT', blank: 'after' },
  { word: 'BEST', blank: 'after' },
  { word: 'AMERICAN', blank: 'after' },
  { word: 'NICE', blank: 'after' },
  { word: 'MONKEY', blank: 'after' },
  { word: 'FALSE', blank: 'after' },
  { word: 'CHEAP', blank: 'after' },
  { word: 'TOOTH', blank: 'after' },
  { word: 'SOFT', blank: 'after' },
  { word: 'HEART', blank: 'after' },
  { word: 'PARTY', blank: 'after' },
  { word: 'SOUL', blank: 'after' },
  { word: 'HOLY', blank: 'after' },
  { word: 'CHOP', blank: 'after' },
  { word: 'PENNY', blank: 'after' },
  { word: 'BOTTOM', blank: 'after' },
  { word: 'EVENING', blank: 'after' },
  { word: 'LEFT', blank: 'after' },
  { word: 'CAR', blank: 'after' },
  { word: 'GIFT', blank: 'after' },
  { word: 'DAY', blank: 'after' },
  { word: 'STRIP', blank: 'after' },
  { word: 'NO', blank: 'after' },
  { word: 'COUNTRY', blank: 'after' },
  { word: 'SILVER', blank: 'after' },
  { word: 'SUMMER', blank: 'after' },
  { word: 'JET', blank: 'after' },
  { word: 'PRIME', blank: 'after' },
  { word: 'HALF', blank: 'after' },
  { word: 'PAPER', blank: 'after' },
  { word: 'BETTER', blank: 'after' },
  { word: 'SOUND', blank: 'after' },
  { word: 'ROUND', blank: 'after' },
  { word: 'FRIED', blank: 'after' },
  { word: 'BELLY', blank: 'after' },
  { word: 'GREAT', blank: 'after' },
  { word: 'TRUCK', blank: 'after' },
  { word: 'CHAIN', blank: 'after' },
  { word: 'BRASS', blank: 'after' },
  { word: 'BACK', blank: 'after' },
  { word: 'TROPICAL', blank: 'after' },
  { word: 'CHICKEN', blank: 'after' },
  { word: 'HEALTH', blank: 'after' },
  { word: 'SNOW', blank: 'after' },
  { word: 'HYPER', blank: 'after' },
  { word: 'HAPPY', blank: 'after' },
  { word: 'GUESS', blank: 'after' },
  { word: 'RED', blank: 'after' },
  { word: 'TIGHT', blank: 'after' },
  { word: 'JAIL', blank: 'after' },
  { word: 'CHRISTMAS', blank: 'after' },
  { word: 'HAND', blank: 'after' },
  { word: 'ROCK', blank: 'after' },
  { word: 'CENTER', blank: 'after' },
  { word: 'RUBBER', blank: 'after' },
  { word: 'MOVING', blank: 'after' },
  { word: 'OVER', blank: 'after' },
  { word: 'PEPPER', blank: 'after' },
  { word: 'CHERRY', blank: 'after' },
  { word: 'SALT', blank: 'after' },
  { word: 'GO', blank: 'after' },
  { word: 'POCKET', blank: 'after' },
  { word: 'MASTER', blank: 'after' },
  { word: 'RIGHT', blank: 'after' },
  { word: 'OH', blank: 'after' },
  { word: 'FULL', blank: 'after' },
  { word: 'GRAND', blank: 'after' },
  { word: 'MOUNTAIN', blank: 'after' },
  { word: 'GUESS', blank: 'after' },
  { word: 'EVEN', blank: 'after' },
  { word: 'CRAB', blank: 'after' },
  { word: 'HEAVY', blank: 'after' },
  { word: 'GRAPE', blank: 'after' },
  { word: 'KEY', blank: 'after' },
  { word: 'DEEP', blank: 'after' },
  { word: 'SWEAT', blank: 'after' },
  { word: 'ROLLER', blank: 'after' },
  { word: 'BIG', blank: 'after' },
  { word: 'LUNCH', blank: 'after' },
  { word: 'CANDY', blank: 'after' },
  { word: 'NEVER', blank: 'after' },
  { word: 'HEAD', blank: 'after' },
  { word: 'SEA', blank: 'after' },
  { word: 'SHORT', blank: 'after' },
  { word: 'MEAT', blank: 'after' },

  { word: 'SHOWER', blank: 'before' },
  { word: 'WATER', blank: 'before' },
  { word: 'STORY', blank: 'before' },
  { word: 'DATE', blank: 'before' },
  { word: 'ORDER', blank: 'before' },
  { word: 'STOOL', blank: 'before' },
  { word: 'MATE', blank: 'before' },
  { word: 'WATER', blank: 'before' },
  { word: 'BONE', blank: 'before' },
  { word: 'BITE', blank: 'before' },
  { word: 'SPOT', blank: 'before' },
  { word: 'BELLY', blank: 'before' },
  { word: 'JOB', blank: 'before' },
  { word: 'BAR', blank: 'before' },
  { word: 'LUCK', blank: 'before' },
  { word: 'WEIGHT', blank: 'before' },
  { word: 'COW', blank: 'before' },
  { word: 'GEAR', blank: 'before' },
  { word: 'GUY', blank: 'before' },
  { word: 'DUTY', blank: 'before' },
  { word: 'MARKET', blank: 'before' },
  { word: 'DROP', blank: 'before' },
  { word: 'WELL', blank: 'before' },
  { word: 'CLOCK', blank: 'before' },
  { word: 'SHRINE', blank: 'before' },
  { word: 'BAG', blank: 'before' },
  { word: 'BREAD', blank: 'before' },
  { word: 'GLOVE', blank: 'before' },
  { word: 'SHOP', blank: 'before' },
  { word: 'FRAME', blank: 'before' },
  { word: 'FLOOR', blank: 'before' },
  { word: 'FOOD', blank: 'before' },
  { word: 'BASKET', blank: 'before' },
  { word: 'NAME', blank: 'before' },
  { word: 'FACE', blank: 'before' },
  { word: 'FIELD', blank: 'before' },
  { word: 'GROWN', blank: 'before' },
  { word: 'POLE', blank: 'before' },
  { word: 'GUN', blank: 'before' },
  { word: 'DRIVER', blank: 'before' },
  { word: 'BLUE', blank: 'before' },
  { word: 'ACHE', blank: 'before' },
  { word: 'DOG', blank: 'before' },
  { word: 'GREEN', blank: 'before' },
  { word: 'WALK', blank: 'before' },
  { word: 'SERVICE', blank: 'before' },
  { word: 'KEY', blank: 'before' },
  { word: 'OFFICE', blank: 'before' },
  { word: 'POT', blank: 'before' },
  { word: 'TANK', blank: 'before' },
  { word: 'KEEPER', blank: 'before' },
  { word: 'BURN', blank: 'before' },
  { word: 'CREAM', blank: 'before' },
  { word: 'BRUSH', blank: 'before' },
  { word: 'DUCK', blank: 'before' },
  { word: 'BOAT', blank: 'before' },
  { word: 'FRY', blank: 'before' },
  { word: 'COURT', blank: 'before' },
  { word: 'STATION', blank: 'before' },
  { word: 'FEET', blank: 'before' },
  { word: 'COAT', blank: 'before' },
  { word: 'REST', blank: 'before' },
  { word: 'BUG', blank: 'before' },
  { word: 'SHOT', blank: 'before' },
  { word: 'DOLLAR', blank: 'before' },
  { word: 'CHILD', blank: 'before' },
  { word: 'BOARD', blank: 'before' },
  { word: 'COURSE', blank: 'before' },
  { word: 'CLUB', blank: 'before' },
  { word: 'BERRY', blank: 'before' },
  { word: 'BOWL', blank: 'before' },
  { word: 'BIRD', blank: 'before' },
  { word: 'POTATO', blank: 'before' },
  { word: 'DANCE', blank: 'before' },
  { word: 'HOUR', blank: 'before' },
  { word: 'LAND', blank: 'before' },
  { word: 'CHANCE', blank: 'before' },
  { word: 'GUESS', blank: 'before' },
  { word: 'FINGER', blank: 'before' },
  { word: 'LOAD', blank: 'before' },
  { word: 'CORN', blank: 'before' },
  { word: 'PAPER', blank: 'before' },
  { word: 'FIRE', blank: 'before' },
  { word: 'CYCLE', blank: 'before' },
  { word: 'FEE', blank: 'before' },
  { word: 'OIL', blank: 'before' },
  { word: 'TICKET', blank: 'before' },
  { word: 'SALAD', blank: 'before' },
  { word: 'GUARD', blank: 'before' },
  { word: 'DRIVE', blank: 'before' },
  { word: 'BEE', blank: 'before' },
  { word: 'STAR', blank: 'before' },
  { word: 'STOP', blank: 'before' },
  { word: 'MOUTH', blank: 'before' },
  { word: 'CUP', blank: 'before' },
  { word: 'LIFE', blank: 'before' },
  { word: 'PIT', blank: 'before' },
  { word: 'STORM', blank: 'before' },
  { word: 'ROOM', blank: 'before' },
  { word: 'DOWN', blank: 'before' },
  { word: 'HAND', blank: 'before' },
  { word: 'BLANKET', blank: 'before' },
  { word: 'BED', blank: 'before' },
  { word: 'MEAT', blank: 'before' },
  { word: 'BEAR', blank: 'before' },
  { word: 'FREE', blank: 'before' },
  { word: 'JUICE', blank: 'before' },
  { word: 'CAKE', blank: 'before' },
  { word: 'LIMIT', blank: 'before' },
  { word: 'WASH', blank: 'before' },
  { word: 'BUSINESS', blank: 'before' },
  { word: 'SAUCE', blank: 'before' },
  { word: 'HOLE', blank: 'before' },
  { word: 'POWER', blank: 'before' },
  { word: 'PEN', blank: 'before' },
  { word: 'PICK', blank: 'before' },
  { word: 'BODY', blank: 'before' },
  { word: 'RING', blank: 'before' },
  { word: 'AID', blank: 'before' },
  { word: 'GLASS', blank: 'before' },
  { word: 'TOWN', blank: 'before' },
  { word: 'HORSE', blank: 'before' },
  { word: 'DOOR', blank: 'before' },
  { word: 'PAD', blank: 'before' },
  { word: 'DOLL', blank: 'before' },
  { word: 'CLASS', blank: 'before' },
  { word: 'FISH', blank: 'before' },
  { word: 'LIGHT', blank: 'before' },
  { word: 'BAND', blank: 'before' },
  { word: 'FLY', blank: 'before' },
  { word: 'BEER', blank: 'before' },
  { word: 'SKATE', blank: 'before' },
  { word: 'BREAK', blank: 'before' },
  { word: 'SEAT', blank: 'before' },
  { word: 'PAINT', blank: 'before' },
  { word: 'BEAN', blank: 'before' },
  { word: 'EGG', blank: 'before' },
  { word: 'TABLE', blank: 'before' },
  { word: 'JAM', blank: 'before' },
  { word: 'SUIT', blank: 'before' },
  { word: 'HARD', blank: 'before' },
  { word: 'SPOT', blank: 'before' },
  { word: 'DRUM', blank: 'before' },
  { word: 'MARK', blank: 'before' },
  { word: 'BALL', blank: 'before' },
  { word: 'NIGHT', blank: 'before' },
  { word: 'FRIEND', blank: 'before' },
  { word: 'FLAKES', blank: 'before' },
  { word: 'LESS', blank: 'before' },
  { word: 'BLOCK', blank: 'before' },
  { word: 'CHIP', blank: 'before' },
  { word: 'TENNIS', blank: 'before' },
  { word: 'CHOCOLATE', blank: 'before' },
  { word: 'FAIR', blank: 'before' },
  { word: 'BOOK', blank: 'before' },
  { word: 'CUT', blank: 'before' },
  { word: 'TIME', blank: 'before' },
  { word: 'GOOD', blank: 'before' },
  { word: 'DONE', blank: 'before' },
  { word: 'CONTROL', blank: 'before' },
  { word: 'PIE', blank: 'before' },
  { word: 'PARTY', blank: 'before' },
  { word: 'WORD', blank: 'before' },
  { word: 'LANGUAGE', blank: 'before' },
  { word: 'POWDER', blank: 'before' },
  { word: 'FRONT', blank: 'before' },
  { word: 'FLOW', blank: 'before' },
  { word: 'FIGHT', blank: 'before' },
  { word: 'FLIGHT', blank: 'before' },
  { word: 'PRINT', blank: 'before' },
  { word: 'EVER', blank: 'before' },
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
