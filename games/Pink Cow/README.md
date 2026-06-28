# 🐄 Pink Cow — the crowd-matching party game

Think like the herd. Don't stand out. The pink cow blocks your win.

## Setup (one-time)

You need Node.js installed (https://nodejs.org — any recent version).

```
cd pink-cow
npm install
npm start
```

The server starts at **http://localhost:3000**

## Playing

1. The person hosting the game opens http://localhost:3000 on their machine
   and creates a room.
2. Every other player opens http://YOUR_IP:3000 on their phone
   (same wifi network). Or deploy to a hosting service for internet play.
3. Share the 4-letter room code. Host starts the game.

## Rules (as coded)

- A question appears on everyone's screen simultaneously.
- Each player types what they think **most other players will also write**.
- Answers are revealed all at once. The host can tap Merge on two players
  to group their answers if they mean the same thing.
- **Most common answer = 1 point.** Tied = no points.
- **Solo answer (unique) = 🐄 Pink Cow.** You can score but can't win.
  You lose the cow when someone else gives a solo answer.
- First to **8 points** wins. On a draw, play to 9, 10, etc.

## Adding custom questions

Open `questions.js` and add to the `CUSTOM_QUESTIONS` array at the bottom:

```js
const CUSTOM_QUESTIONS = [
  "Name something you'd find at a garden party",
  "Name a reason your neighbour might call the police",
];
```

Save, restart the server (`npm start`), and they'll shuffle in.

## Files

- `server.js` — Node WebSocket server (all game logic lives here)
- `client.html` — the single page served to every player's phone
- `questions.js` — the question pack + your custom questions
- `package.json` — just the `ws` dependency

## Deploy online

Any Node host works (Railway, Render, Fly.io, etc.). Set the PORT environment
variable if needed — the server reads `process.env.PORT` automatically.
