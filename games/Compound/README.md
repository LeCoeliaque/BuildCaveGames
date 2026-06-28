# Compound!
*The word game where thinking alike pays off.*

## Setup

### Requirements
- Node.js (v16 or higher) — download from https://nodejs.org

### Install & Run

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

The server starts on port 3000 by default.

### Playing

1. Open **http://localhost:3000** in your browser
2. Enter your name and a room code (anything you like — make it up!)
3. Share the room code + your computer's **local IP address** with friends on the same network
   - e.g. they go to `http://192.168.1.42:3000` and enter the same room code
4. The host (first to join) presses **Start Game** once everyone is in

### Playing over the internet
To play with people not on your local network, deploy to a free service like:
- **Railway** → https://railway.app (drag and drop this folder)
- **Render** → https://render.com
- **Fly.io** → https://fly.io

All three support WebSockets and have free tiers.

## How to Play

Each round, a card is shown with a word and a blank:
- `___ TOWN` or `FIRE ___`

Every player secretly writes **one word** that forms a compound word or common phrase. When time's up (or everyone answers), all answers are revealed.

**Scoring:**
- Exactly **one** other player wrote the same word → **3 points each**
- **More than one** other player wrote it → **1 point each**  
- **Nobody** else wrote it → **0 points**

First to **20 points** wins.

## Customising

- **Target score:** Change `TARGET_SCORE` at the top of `server.js`
- **Timer:** Change the `30` in `startRound()` in `server.js`  
- **Cards:** Add more entries to the `CARDS` array in `server.js`
- **Port:** Set the `PORT` environment variable, e.g. `PORT=8080 npm start`
