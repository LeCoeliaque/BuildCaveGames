/*  Pink Cow — WebSocket server
 *  Run: node server.js
 *  All game logic lives server-side; clients are thin views.
 *
 *  Message protocol (all JSON):
 *  Client → Server:  { type, ...payload }
 *  Server → Client:  { type, ...payload }
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const { QUESTIONS } = require('./questions.js');

const PORT = process.env.PORT || 3000;

/* ---- HTTP: serve the single client HTML file ----------------------------- */
const html = fs.readFileSync(path.join(__dirname, 'client.html'), 'utf8');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200); res.end('ok'); return;
  }
  if (req.url === '/logo.png') {
    const logoPath = path.join(__dirname, 'logo.png');
    if (fs.existsSync(logoPath)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      fs.createReadStream(logoPath).pipe(res);
    } else {
      res.writeHead(404); res.end();
    }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

/* ---- Rooms --------------------------------------------------------------- */
const rooms = new Map();   // roomCode -> Room

function makeCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Normalize an answer for matching: lowercase, strip punctuation, trim,
   remove leading articles (a/an/the), basic de-pluralise last word.       */
function normalize(raw) {
  let s = raw.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
  s = s.replace(/^(a |an |the )/, '');
  // very light stemming: strip trailing 's' if word > 3 chars and doesn't end in 'ss'
  const words = s.split(' ');
  const last = words[words.length - 1];
  if (last.length > 3 && last.endsWith('s') && !last.endsWith('ss')) {
    words[words.length - 1] = last.slice(0, -1);
  }
  return words.join(' ').trim();
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();     // id -> { id, name, ws, score, hasCow, connected }
    this.hostId = null;
    this.state = 'lobby';         // lobby | answering | review | scores
    this.questions = shuffle(QUESTIONS);
    this.questionIdx = -1;
    this.currentQuestion = null;
    this.answers = new Map();     // playerId -> raw answer string
    this.groups = [];             // [{ ids:[], normalized, display }]  — built after answers in
    this.winTarget = 8;
  }

  get host() { return this.players.get(this.hostId); }

  addPlayer(id, name, ws) {
    const isFirst = this.players.size === 0;
    this.players.set(id, { id, name, ws, score: 0, hasCow: false, connected: true });
    if (isFirst) this.hostId = id;
  }

  broadcast(msg, excludeId = null) {
    const data = JSON.stringify(msg);
    this.players.forEach((p) => {
      if (p.id !== excludeId && p.connected && p.ws.readyState === WebSocket.OPEN)
        p.ws.send(data);
    });
  }

  send(playerId, msg) {
    const p = this.players.get(playerId);
    if (p && p.connected && p.ws.readyState === WebSocket.OPEN)
      p.ws.send(JSON.stringify(msg));
  }

  sendAll(msg) {
    const data = JSON.stringify(msg);
    this.players.forEach((p) => {
      if (p.connected && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
    });
  }

  lobbyState() {
    return {
      code: this.code,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, score: p.score, hasCow: p.hasCow,
      })),
      hostId: this.hostId,
      winTarget: this.winTarget,
    };
  }

  /* ---- game flow ---- */
  startGame() {
    this.state = 'answering';
    this.questionIdx = -1;
    this.players.forEach((p) => { p.score = 0; p.hasCow = false; });
    this.nextQuestion();
  }

  nextQuestion() {
    this.questionIdx++;
    if (this.questionIdx >= this.questions.length) {
      // reshuffle if we've run out (unlikely but safe)
      this.questions = shuffle(QUESTIONS);
      this.questionIdx = 0;
    }
    this.currentQuestion = this.questions[this.questionIdx];
    this.answers.clear();
    this.groups = [];
    this.state = 'answering';
    this.sendAll({
      type: 'question',
      question: this.currentQuestion,
      round: this.questionIdx + 1,
      players: this.lobbyState().players,
    });
  }

  submitAnswer(playerId, raw) {
    if (this.state !== 'answering') return;
    if (!raw || !raw.trim()) return;
    this.answers.set(playerId, raw.trim());
    // Tell everyone a player has answered (but not what)
    this.sendAll({ type: 'answered', playerId, total: this.answers.size,
      needed: this.players.size });
    // All connected players answered → move to review
    const connected = [...this.players.values()].filter((p) => p.connected);
    if (this.answers.size >= connected.length) this.buildGroups();
  }

  buildGroups() {
    // Group answers by normalized form.
    const map = new Map();   // normalized -> { display: string, ids: [] }
    this.answers.forEach((raw, pid) => {
      const norm = normalize(raw);
      if (!map.has(norm)) map.set(norm, { normalized: norm, display: raw, ids: [] });
      map.get(norm).ids.push(pid);
    });
    this.groups = [...map.values()];
    this.state = 'review';

    // Send full reveal to everyone
    const reveal = this.groups.map((g) => ({
      normalized: g.normalized,
      display: g.display,
      ids: g.ids,
      answers: g.ids.map((id) => ({
        playerId: id,
        name: this.players.get(id)?.name,
        answer: this.answers.get(id),
      })),
    }));
    this.sendAll({ type: 'reveal', groups: reveal,
      players: this.lobbyState().players, hostId: this.hostId });
  }

  /* Host taps two player IDs to merge their answers into one group. */
  mergeGroups(idA, idB) {
    const gi = (id) => this.groups.findIndex((g) => g.ids.includes(id));
    const a = gi(idA), b = gi(idB);
    if (a === -1 || b === -1 || a === b) return;
    // Merge b into a
    this.groups[a].ids = [...this.groups[a].ids, ...this.groups[b].ids];
    this.groups.splice(b, 1);
    // Re-send updated reveal
    const reveal = this.groups.map((g) => ({
      normalized: g.normalized,
      display: g.display,
      ids: g.ids,
      answers: g.ids.map((id) => ({
        playerId: id, name: this.players.get(id)?.name, answer: this.answers.get(id),
      })),
    }));
    this.sendAll({ type: 'reveal', groups: reveal,
      players: this.lobbyState().players, hostId: this.hostId });
  }

  /* Host confirms — score the round. */
  confirmScoring() {
    if (this.state !== 'review') return;
    this.state = 'scores';

    // Find the max group size
    const maxSize = Math.max(...this.groups.map((g) => g.ids.length));
    const topGroups = this.groups.filter((g) => g.ids.length === maxSize);

    // Score
    const delta = {};
    const cowWinner = [];
    const points = {};
    this.players.forEach((p) => { delta[p.id] = 0; points[p.id] = 0; });

    if (topGroups.length === 1) {
      // One clear majority — everyone in it scores 1pt
      topGroups[0].ids.forEach((id) => { delta[id] = 1; });
    }
    // else: tie — no one scores (as per rules)

    // Pink cow: any player who gave a unique answer (group size 1) gets the cow
    const soloGroups = this.groups.filter((g) => g.ids.length === 1);
    if (soloGroups.length > 0) {
      // If there's already a cow holder and they're solo, it passes from them
      // to the last solo player (rules: passes when someone else is solo)
      const soloIds = soloGroups.map((g) => g.ids[0]);
      // Clear current cow
      let hadCow = null;
      this.players.forEach((p) => { if (p.hasCow) { hadCow = p.id; p.hasCow = false; } });
      // Assign cow to first solo player who isn't the current holder
      // (if all solos are the same as current holder, they keep it)
      const newCowHolder = soloIds.find((id) => id !== hadCow) || soloIds[0];
      const p = this.players.get(newCowHolder);
      if (p) { p.hasCow = true; cowWinner.push(newCowHolder); }
    }

    // Apply score deltas
    this.players.forEach((p) => { p.score += delta[p.id]; points[p.id] = p.score; });

    // Check win: highest scorer WITHOUT the cow who has reached winTarget
    const eligible = [...this.players.values()].filter((p) => !p.hasCow);
    const maxScore = Math.max(0, ...eligible.map((p) => p.score));
    let winner = null;
    if (maxScore >= this.winTarget) {
      // Check for a draw among eligible players
      const tied = eligible.filter((p) => p.score === maxScore);
      if (tied.length === 1) {
        winner = tied[0].id;
        this.winTarget = 8; // reset for next game
      } else {
        // Tiebreak: bump target by 1
        this.winTarget = maxScore + 1;
      }
    }

    const result = {
      type: 'roundResult',
      question: this.currentQuestion,
      groups: this.groups.map((g) => ({
        display: g.display, ids: g.ids,
        answers: g.ids.map((id) => ({
          playerId: id, name: this.players.get(id)?.name, answer: this.answers.get(id),
        })),
      })),
      delta,
      scores: points,
      cowHolder: [...this.players.values()].find((p) => p.hasCow)?.id || null,
      cowWinner: cowWinner[0] || null,
      topGroupSize: maxSize,
      tie: topGroups.length > 1,
      winner,
      winTarget: this.winTarget,
      players: this.lobbyState().players,
    };
    this.sendAll(result);

    if (winner) this.state = 'lobby';
  }
}

/* ---- WebSocket server ---------------------------------------------------- */
const wss = new WebSocketServer({ server });

// playerId -> { roomCode, playerId }
const connections = new Map();

wss.on('connection', (ws) => {
  let myId = null;
  let myRoom = null;
  console.log('WS client connected');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const room = myRoom ? rooms.get(myRoom) : null;

    try {
      switch (msg.type) {
        case 'createRoom': {
          let code = makeCode();
          while (rooms.has(code)) code = makeCode();
          const r = new Room(code);
          rooms.set(code, r);
          myId = msg.playerId || makeCode();
          myRoom = code;
          r.addPlayer(myId, msg.name, ws);
          connections.set(ws, { roomCode: code, playerId: myId });
          ws.send(JSON.stringify({ type: 'joined', playerId: myId,
            isHost: true, ...r.lobbyState() }));
          console.log('Room created:', code, 'by', msg.name);
          break;
        }
        case 'joinRoom': {
          const code = (msg.code || '').toUpperCase();
          const r = rooms.get(code);
          if (!r) { ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' })); break; }
          if (r.state !== 'lobby') { ws.send(JSON.stringify({ type: 'error', msg: 'Game already in progress' })); break; }
          myId = msg.playerId || makeCode();
          myRoom = code;
          r.addPlayer(myId, msg.name, ws);
          connections.set(ws, { roomCode: code, playerId: myId });
          ws.send(JSON.stringify({ type: 'joined', playerId: myId,
            isHost: false, ...r.lobbyState() }));
          r.broadcast({ type: 'lobbyUpdate', ...r.lobbyState() }, myId);
          console.log(msg.name, 'joined room', code);
          break;
        }
        case 'startGame':
          if (!room || myId !== room.hostId) break;
          if (room.players.size < 2) {
            ws.send(JSON.stringify({ type: 'error', msg: 'Need at least 2 players' })); break;
          }
          room.startGame(); break;
        case 'submitAnswer':
          if (!room || room.state !== 'answering') break;
          room.submitAnswer(myId, msg.answer); break;
        case 'mergeGroups':
          if (!room || myId !== room.hostId) break;
          room.mergeGroups(msg.playerA, msg.playerB); break;
        case 'confirmScoring':
          if (!room || myId !== room.hostId) break;
          room.confirmScoring(); break;
        case 'nextQuestion':
          if (!room || myId !== room.hostId) break;
          room.nextQuestion(); break;
        case 'newGame':
          if (!room || myId !== room.hostId) break;
          room.startGame(); break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' })); break;
      }
    } catch (err) {
      console.error('Error handling message type:', msg?.type, err.message, err.stack);
      try { ws.send(JSON.stringify({ type: 'error', msg: 'Server error: ' + err.message })); } catch {}
    }
  });

  ws.on('error', (err) => console.error('WS error:', err.message));

  ws.on('close', (code) => {
    console.log('WS client disconnected, code:', code);
    if (myId && myRoom) {
      const r = rooms.get(myRoom);
      if (r) {
        const p = r.players.get(myId);
        if (p) p.connected = false;
        setTimeout(() => {
          const still = rooms.get(myRoom);
          if (still && [...still.players.values()].every((p) => !p.connected)) {
            rooms.delete(myRoom);
          }
        }, 5 * 60 * 1000);
        r.broadcast({ type: 'lobbyUpdate', ...r.lobbyState() });
      }
    }
    connections.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`\n🐄 Pink Cow running at http://localhost:${PORT}\n`);
});