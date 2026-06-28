# TriviaWheel v4

Multiplayer trivia board game. Square board with 8 HQ wedge squares, 4 spokes, and a centre win square.

## Setup

```
npm install
```

## Folder structure

```
triviawheel/
  assets/
    board.png          ← Your board image (2048×2048)
    token_0.png        ← Optional player token PNGs (falls back to coloured circles)
    token_1.png
    ...
  categories/          ← Free-response questions (HQ/capital squares)
    01_geography.json
    02_history.json
    ...
    09_centre.json     ← Centre win question category (9th file alphabetically)
  categories_mc/       ← Multiple-choice questions (ring squares)
    01_science.json
    02_pop_culture.json
    ...
  server.js
  index.html
  clean_mc.js          ← Strip metadata from MC files before first run
  clean.js             ← Strip metadata from free-response files
  package.json
```

## Category files

**Free-response** (`categories/`): First 8 files (alphabetically) = HQ categories. 9th file = centre question.
```json
[{"Question": "What is the capital of France?", "Answer": "Paris"}]
```

**Multiple-choice** (`categories_mc/`): First 8 files = ring square categories. Run `node clean_mc.js` first to strip metadata.
```json
[{"question": "...", "answer": "C", "options": {"A":"...","B":"...","C":"...","D":"...","E":"..."}}]
```

Raw MC format (before cleaning):
```json
{"id": 1, "subject": "...", "question": "Question text A. opt B. opt C. opt D. opt E. opt", "answer": "C", "metadata": "..."}
```

## Running

```
node clean_mc.js    # first time only — strips MC metadata
node server.js
```

Then open `http://localhost:3000` in a browser. Share the room code with other players.

## Game rules

- **Roll** the dice on your turn
- Move clockwise around the ring
- **Ring squares** → multiple choice question (5 options, all visible)
- **HQ squares** (★) → free response question. Answer correctly to earn that wedge. Already own the wedge? You roll past it
- **Correct answer** → roll again. Wrong → steal window opens (other players can buzz in)
- **After any ruling** → 10 second challenge window. Anyone can challenge, name who they think got it right, then all other players vote
- **Midpoint HQs** → after earning the wedge, choose to stay on ring or go inward down the spoke toward the centre
- **Centre** → need all 8 wedges to enter. Answer a centre question correctly to win

## Category colours (by file load order)

| # | Hex | Colour |
|---|-----|--------|
| 1 | `#e74c3c` | Red |
| 2 | `#3498db` | Blue |
| 3 | `#8e44ad` | Purple |
| 4 | `#e67e22` | Orange |
| 5 | `#27ae60` | Green |
| 6 | `#f1c40f` | Yellow |
| 7 | `#1abc9c` | Teal |
| 8 | `#e91e63` | Pink |
| Centre | `#f0c040` | Gold |
