/**
 * Azul Multiplayer Server
 * Run: node server.js
 * Requires: npm install ws
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// ─── Azul Game Logic ────────────────────────────────────────────────────────

const COLORS = ['BLUE', 'YELLOW', 'RED', 'BLACK', 'TEAL'];
const FACTORY_COUNTS = [0, 0, 5, 7, 9]; // index = num players

/** Column on the wall where a colour belongs in a given row */
function wallColumn(row, colorName) {
    const ci = COLORS.indexOf(colorName);
    return ((ci - row) % 5 + 5) % 5;
}

// Cumulative floor penalties: real Azul -1,-1,-2,-2,-3,-3,-3
// index = number of tiles on floor line (capped at 7)
const FLOOR_SCORES = [0, -1, -2, -4, -6, -9, -12, -15];

function makeBag() {
    const bag = [];
    for (const c of COLORS) for (let i = 0; i < 20; i++) bag.push(c);
    return bag;
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function drawTiles(bag, num) {
    const drawn = [];
    const actual = Math.min(num, bag.length);
    for (let i = 0; i < actual; i++) {
        const idx = Math.floor(Math.random() * bag.length);
        drawn.push(bag.splice(idx, 1)[0]);
    }
    return drawn;
}

function makePlayerState(name) {
    return {
        name,
        score: 0,
        wall: Array.from({ length: 5 }, () => Array(5).fill(null)),
        buildRows: Array.from({ length: 5 }, (_, i) => ({ color: null, count: 0, capacity: i + 1 })),
        floorLine: [],
        selectedTiles: null,
    };
}

class AzulGame {
    constructor(playerNames) {
        this.numPlayers = playerNames.length;
        this.players = playerNames.map(makePlayerState);
        this.bag = shuffle(makeBag());
        this.boxLid = [];
        this.factories = Array.from({ length: FACTORY_COUNTS[this.numPlayers] }, () => []);
        this.centerArea = [];
        this.curPlayer = Math.floor(Math.random() * this.numPlayers);
        this.phase = 'pick';
        this.winner = null;
        this.round = 1;
        this._fillFactories();
        this.centerArea = ['WHITE'];
    }

    _fillFactories() {
        for (let i = 0; i < this.factories.length; i++) {
            let drawn = drawTiles(this.bag, 4);
            if (drawn.length < 4 && this.boxLid.length > 0) {
                this.bag.push(...this.boxLid);
                this.boxLid = [];
                shuffle(this.bag);
                drawn = drawn.concat(drawTiles(this.bag, 4 - drawn.length));
            }
            this.factories[i] = drawn;
        }
    }

    _roundOver() {
        if (this.factories.some(f => f.length > 0)) return false;
        if (this.centerArea.some(c => c !== 'WHITE')) return false;
        return true;
    }

    _gameOver() {
        return this.players.some(p =>
            p.wall.some(row => row.every(c => c !== null))
        );
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    pickFromFactory(playerIdx, factoryIdx, color) {
        if (playerIdx !== this.curPlayer) return { ok: false, error: 'Not your turn' };
        if (this.phase !== 'pick') return { ok: false, error: 'Wrong phase' };
        if (this.players[playerIdx].selectedTiles) return { ok: false, error: 'Already have selected tiles' };
        if (color === 'WHITE') return { ok: false, error: 'Cannot pick the first-player token from a factory' };

        const factory = this.factories[factoryIdx];
        if (!factory || !factory.includes(color)) return { ok: false, error: `No ${color} tiles in factory ${factoryIdx}` };

        const picked = factory.filter(c => c === color);
        const rest = factory.filter(c => c !== color);
        this.factories[factoryIdx] = [];
        this.centerArea.push(...rest);

        this.players[playerIdx].selectedTiles = picked;
        this.phase = 'place';
        return { ok: true };
    }

    pickFromCenter(playerIdx, color) {
        if (playerIdx !== this.curPlayer) return { ok: false, error: 'Not your turn' };
        if (this.phase !== 'pick') return { ok: false, error: 'Wrong phase' };
        if (this.players[playerIdx].selectedTiles) return { ok: false, error: 'Already have selected tiles' };

        // Special case: picking the first-player token directly
        if (color === 'WHITE') {
            if (!this.centerArea.includes('WHITE')) return { ok: false, error: 'No WHITE token in center' };
            this.centerArea = this.centerArea.filter(c => c !== 'WHITE');
            this.players[playerIdx].selectedTiles = ['WHITE'];
            this.phase = 'place';
            return { ok: true };
        }

        if (!this.centerArea.includes(color)) return { ok: false, error: `No ${color} tiles in center` };

        // Take all tiles of the chosen colour
        const picked = this.centerArea.filter(c => c === color);
        this.centerArea = this.centerArea.filter(c => c !== color);

        // If the WHITE first-player token is still in center, grab it too (goes to floor)
        if (this.centerArea.includes('WHITE')) {
            picked.push('WHITE');
            this.centerArea = this.centerArea.filter(c => c !== 'WHITE');
        }

        this.players[playerIdx].selectedTiles = picked;
        this.phase = 'place';
        return { ok: true };
    }

    canPlaceOnRow(playerIdx, row) {
        const p = this.players[playerIdx];
        if (!p.selectedTiles) return false;

        const colored = p.selectedTiles.filter(c => c !== 'WHITE');
        if (colored.length === 0) return false; // only the first-player token — must go to floor

        const color = colored[0];
        const br = p.buildRows[row];
        const wallCol = wallColumn(row, color);

        if (p.wall[row][wallCol] !== null) return false; // already placed this colour in this row
        if (br.color !== null && br.color !== color) return false; // row has a different colour
        if (br.count >= br.capacity) return false; // row is full
        return true;
    }

    placeTiles(playerIdx, row) {
        if (playerIdx !== this.curPlayer) return { ok: false, error: 'Not your turn' };
        if (this.phase !== 'place') return { ok: false, error: 'Wrong phase' };
        const p = this.players[playerIdx];
        if (!p.selectedTiles) return { ok: false, error: 'No tiles selected' };

        const whites = p.selectedTiles.filter(c => c === 'WHITE');
        const colored = p.selectedTiles.filter(c => c !== 'WHITE');

        if (row > 4) {
            // Deliberately sending everything to the floor
            p.floorLine.push(...p.selectedTiles);
        } else {
            if (!this.canPlaceOnRow(playerIdx, row)) return { ok: false, error: 'Cannot place tiles on that row' };

            // WHITE token always goes to floor line
            p.floorLine.push(...whites);

            const br = p.buildRows[row];
            const color = colored[0];
            br.color = color;
            const space = br.capacity - br.count;
            const toPlace = Math.min(colored.length, space);
            const overflow = colored.length - toPlace;
            br.count += toPlace;
            for (let i = 0; i < overflow; i++) p.floorLine.push(color);
        }

        p.selectedTiles = null;
        this.phase = 'pick';

        if (this._roundOver()) {
            this._endRound();
        } else {
            this.curPlayer = (this.curPlayer + 1) % this.numPlayers;
        }
        return { ok: true };
    }

    // ── Round / Game end ─────────────────────────────────────────────────────

    _endRound() {
        let nextFirstPlayer = this.curPlayer;
        const allDiscard = [];

        for (let i = 0; i < this.numPlayers; i++) {
            const { discard, tookWhite } = this._finishPlayerRound(i);
            if (tookWhite) nextFirstPlayer = i;
            allDiscard.push(...discard);
        }

        this.boxLid.push(...allDiscard);

        if (this._gameOver()) {
            this._endGame();
        } else {
            this.round++;
            this.curPlayer = nextFirstPlayer;
            this._fillFactories();
            this.centerArea = ['WHITE'];
        }
    }

    _finishPlayerRound(i) {
        const p = this.players[i];
        const discard = [];
        let tookWhite = false;

        for (let row = 0; row < 5; row++) {
            const br = p.buildRows[row];
            if (br.count === br.capacity) {
                const col = wallColumn(row, br.color);
                p.wall[row][col] = br.color;
                this._scoreTile(p, row, col);
                // capacity-1 tiles discarded (1 goes onto wall)
                for (let j = 0; j < br.capacity - 1; j++) discard.push(br.color);
                br.color = null;
                br.count = 0;
            }
        }

        const floorCount = Math.min(p.floorLine.length, 7);
        p.score = Math.max(0, p.score + FLOOR_SCORES[floorCount]);

        for (const t of p.floorLine) {
            if (t === 'WHITE') tookWhite = true;
            else discard.push(t);
        }
        p.floorLine = [];

        return { discard, tookWhite };
    }

    _scoreTile(p, row, col) {
        let hLen = 1;
        for (let c = col + 1; c < 5 && p.wall[row][c]; c++) hLen++;
        for (let c = col - 1; c >= 0 && p.wall[row][c]; c--) hLen++;

        let vLen = 1;
        for (let r = row + 1; r < 5 && p.wall[r][col]; r++) vLen++;
        for (let r = row - 1; r >= 0 && p.wall[r][col]; r--) vLen++;

        const inRow = hLen > 1;
        const inCol = vLen > 1;

        if (!inRow && !inCol) {
            p.score += 1;
        } else {
            if (inRow) p.score += hLen;
            if (inCol) p.score += vLen;
        }
    }

    _endGame() {
        for (const p of this.players) {
            for (let row = 0; row < 5; row++) {
                if (p.wall[row].every(c => c !== null)) p.score += 2;
            }
            for (let col = 0; col < 5; col++) {
                if (p.wall.every(r => r[col] !== null)) p.score += 7;
            }
            for (const color of COLORS) {
                let complete = true;
                for (let row = 0; row < 5; row++) {
                    if (p.wall[row][wallColumn(row, color)] === null) { complete = false; break; }
                }
                if (complete) p.score += 10;
            }
        }

        let maxScore = -1, winner = '';
        for (const p of this.players) {
            if (p.score > maxScore) { maxScore = p.score; winner = p.name; }
        }
        this.winner = winner;
        this.phase = 'over';
    }

    getState(forPlayer) {
        return {
            numPlayers: this.numPlayers,
            players: this.players.map((p, i) => ({
                name: p.name,
                score: p.score,
                wall: p.wall,
                buildRows: p.buildRows,
                floorLine: p.floorLine,
                hasSelectedTiles: !!p.selectedTiles,
                selectedTiles: (forPlayer === i || this.phase === 'over')
                    ? p.selectedTiles
                    : (p.selectedTiles ? ['?'] : null),
                canPlace: (forPlayer === i && !!p.selectedTiles)
                    ? Array.from({ length: 5 }, (_, row) => this.canPlaceOnRow(i, row))
                    : null,
            })),
            factories: this.factories,
            centerArea: this.centerArea,
            curPlayer: this.curPlayer,
            phase: this.phase,
            round: this.round,
            winner: this.winner,
        };
    }
}

// ─── Room & Connection Management ───────────────────────────────────────────

const rooms = {};

function genRoomId() {
    return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function genToken() {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function broadcast(room, msg) {
    for (const { ws } of room.players) {
        if (ws.readyState === 1) ws.send(JSON.stringify(msg));
    }
}

function sendState(room) {
    for (let i = 0; i < room.players.length; i++) {
        const { ws } = room.players[i];
        if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'state', state: room.game.getState(i), yourIndex: i }));
        }
    }
}

function handleMessage(ws, data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {

        case 'create': {
            const roomId = genRoomId();
            const token = genToken();
            rooms[roomId] = { players: [{ ws, name: msg.name, token, connected: true }], game: null, started: false };
            ws.roomId = roomId;
            ws.playerIdx = 0;
            ws.send(JSON.stringify({ type: 'created', roomId, playerIdx: 0, token }));
            broadcast(rooms[roomId], { type: 'lobby', players: [msg.name] });
            break;
        }

        case 'join': {
            const room = rooms[msg.roomId];
            if (!room) { ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' })); return; }
            if (room.started) { ws.send(JSON.stringify({ type: 'error', msg: 'Game already started' })); return; }
            if (room.players.length >= 4) { ws.send(JSON.stringify({ type: 'error', msg: 'Room full' })); return; }
            const idx = room.players.length;
            const token = genToken();
            room.players.push({ ws, name: msg.name, token, connected: true });
            ws.roomId = msg.roomId;
            ws.playerIdx = idx;
            ws.send(JSON.stringify({ type: 'joined', roomId: msg.roomId, playerIdx: idx, token }));
            broadcast(room, { type: 'lobby', players: room.players.map(p => p.name) });
            break;
        }

        case 'reconnect': {
            const room = rooms[msg.roomId];
            if (!room) { ws.send(JSON.stringify({ type: 'error', msg: 'Room not found', fatal: true })); return; }
            const idx = room.players.findIndex(p => p.token === msg.token);
            if (idx === -1) { ws.send(JSON.stringify({ type: 'error', msg: 'Seat not found', fatal: true })); return; }
            // Reattach this socket to the existing seat.
            room.players[idx].ws = ws;
            room.players[idx].connected = true;
            ws.roomId = msg.roomId;
            ws.playerIdx = idx;
            ws.send(JSON.stringify({ type: 'reconnected', roomId: msg.roomId, playerIdx: idx, token: msg.token, started: room.started }));
            if (room.started && room.game) {
                ws.send(JSON.stringify({ type: 'state', state: room.game.getState(idx), yourIndex: idx }));
            } else {
                ws.send(JSON.stringify({ type: 'lobby', players: room.players.map(p => p.name) }));
            }
            broadcast(room, { type: 'player_reconnected', name: room.players[idx].name });
            break;
        }

        case 'start': {
            const room = rooms[ws.roomId];
            if (!room || ws.playerIdx !== 0) return;
            if (room.players.length < 2) { ws.send(JSON.stringify({ type: 'error', msg: 'Need at least 2 players' })); return; }
            room.game = new AzulGame(room.players.map(p => p.name));
            room.started = true;
            sendState(room);
            break;
        }

        case 'pick_factory': {
            const room = rooms[ws.roomId];
            if (!room?.game) return;
            const result = room.game.pickFromFactory(ws.playerIdx, msg.factoryIdx, msg.color);
            if (!result.ok) { ws.send(JSON.stringify({ type: 'error', msg: result.error })); return; }
            sendState(room);
            break;
        }

        case 'pick_center': {
            const room = rooms[ws.roomId];
            if (!room?.game) return;
            const result = room.game.pickFromCenter(ws.playerIdx, msg.color);
            if (!result.ok) { ws.send(JSON.stringify({ type: 'error', msg: result.error })); return; }
            sendState(room);
            break;
        }

        case 'place': {
            const room = rooms[ws.roomId];
            if (!room?.game) return;
            const result = room.game.placeTiles(ws.playerIdx, msg.row);
            if (!result.ok) { ws.send(JSON.stringify({ type: 'error', msg: result.error })); return; }
            sendState(room);
            break;
        }
    }
}

// ─── HTTP + WebSocket Server ─────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.join(__dirname, urlPath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(path.resolve(__dirname))) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath).toLowerCase();
        const types = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
        };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
    ws.on('message', data => handleMessage(ws, data));
    ws.on('close', () => {
        const room = rooms[ws.roomId];
        if (!room) return;
        const seat = room.players[ws.playerIdx];
        if (seat && seat.ws === ws) seat.connected = false;
        broadcast(room, { type: 'player_left', name: seat?.name });
        // Don't delete immediately — give players a window to reconnect after a
        // refresh or network blip. Only clean up if nobody returns.
        const roomId = ws.roomId;
        setTimeout(() => {
            const r = rooms[roomId];
            if (r && r.players.every(p => !p.connected)) delete rooms[roomId];
        }, 5 * 60 * 1000);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Azul server running at http://localhost:${PORT}`));