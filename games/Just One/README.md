# Just One — Multiplayer Web Game

A full-stack web implementation of the cooperative party game **Just One**.

## Quick Start

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

For local network play (friends on the same WiFi), share your local IP:
`http://YOUR_LOCAL_IP:3000`

## How to Play

1. **Create a room** — enter your name and click "Create Room"
2. **Share the room code** — your friends join with the 5-letter code
3. **Start the game** (host only) — need at least 2 players

### Game Rules Summary

- Each round, one player is the **active guesser**
- The active player picks a mystery word from their card (they can't see it)
- All other players secretly write **one clue word** on their easel
- **Identical or similar clues are automatically cancelled** (duplicates eliminated)
- The active player sees only the surviving clues and makes **one guess**
- **Score as many of the 13 cards as possible** cooperatively!

### Scoring
| Score | Rating |
|-------|--------|
| 13 | Perfect score! |
| 12 | Incredible! |
| 11 | Awesome! |
| 9–10 | Not bad at all! |
| 7–8 | Average |
| 4–6 | Good start |
| 0–3 | Try again! |

## 3-Player Variant

With exactly 3 players, each non-active player writes **2 clues** per round (the game auto-detects this).

## Deployment

Set the `PORT` environment variable to change the port (defaults to 3000).

```bash
PORT=8080 npm start
```

Works on any Node.js 16+ host (Railway, Render, Fly.io, Heroku, etc.).
