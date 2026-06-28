# Azul — Online Multiplayer

A full-stack rewrite of the Azul board game with real-time multiplayer via WebSockets.

## Quick Start (Local)

```bash
npm install
npm start
# Open http://localhost:3000 in your browser
```

Share your computer's local IP (e.g. `192.168.1.x:3000`) with players on the same Wi-Fi network.

---

## Deploy to the Web (Free)

### Option 1 — Railway (easiest, recommended)
1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Railway auto-detects Node.js and sets `PORT` automatically
4. Share the generated URL with friends — done!

### Option 2 — Render
1. Push to GitHub
2. Go to [render.com](https://render.com) → New Web Service → Connect your repo
3. Build command: `npm install`  
   Start command: `node server.js`
4. Free tier spins down after inactivity (~30s cold start)

### Option 3 — Fly.io
```bash
npm install -g flyctl
fly launch        # follow prompts
fly deploy
```

### Option 4 — Your own VPS (Nginx + PM2)
```bash
# On your server:
npm install
npm install -g pm2
pm2 start server.js --name azul
# Then point Nginx to port 3000 with WebSocket proxy_pass
```

---

## How to Play (Azul Rules Summary)

**Goal:** Score the most points by filling your wall with colored tiles.

**Each round:**
1. **Pick tiles** — Click a color on a factory (remaining tiles go to center) or pick from the center (first to do so takes the penalty tile).
2. **Place tiles** — Click a build row on your board. Row 1 holds 1 tile, row 5 holds 5. A row can only hold one color, and can't duplicate a color already on that wall row.
3. Tiles go to floor (penalty) if you drop them there, or if overflow occurs.

**End of round:** Complete build rows automatically tile their rightmost matching wall cell and score points based on adjacency.

**End of game:** Triggered when any player completes a full horizontal wall row. Bonuses: +2 per complete row, +7 per complete column, +10 per complete color set.

---

## Architecture

```
azul-multiplayer/
├── server.js     # Node.js HTTP + WebSocket server + full game logic
├── index.html    # Single-page client (no framework, no build step)
└── package.json
```

The game logic lives entirely on the server. Clients send action messages (`pick_factory`, `pick_center`, `place`) and receive authoritative state updates. No cheating possible.
