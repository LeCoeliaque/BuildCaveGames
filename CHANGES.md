# GamesHub — Fixes Applied

## Rules / How-to-Play screens (all six games)
Every game now has an accurate in-app rules screen, reachable from a "?" button in the
header/lobby. Each was written from the actual server logic, not assumptions:
- **Azul** — drafting, the white first-player token, pattern-row placement, wall scoring
  (lone tile = 1, else horizontal + vertical run lengths), exact floor penalties, and the
  +2 / +7 / +10 end-game bonuses.
- **Compound** — the match-but-don't-mob scoring (match exactly one other = +3, three or
  more = +1, unique = 0) with worked examples; first to 20 wins.
- **Gnomin Around** — full golf rules: turn flow, card values, matches, runs (with the
  middle-value rule), mulligan, hazards, bounce, and round-end ±5 bonus.
- **Just One** — cooperative play, the 13-card game, the duplicate-clue cancellation
  mechanic, manual clue cancelling, and the team score.
- **Pink Cow** — majority-scores-1, ties-score-nothing, and the Pink Cow liability that
  blocks the holder from winning; first eligible player to 8 wins.
- **TriviaWheel** — roll/move, free-response vs multiple-choice, correct = roll again,
  wrong = steal, the 8 HQ wedges, the centre finish, and the challenge/vote mechanic.


This pass fixed functional bugs, security issues, reconnection, and Gnomin's
mobile layout + game-logic bugs. Every change below was verified (servers boot,
clients parse, and reconnection + Gnomin logic were tested end-to-end over the
WebSocket).

## TriviaWheel
- **Board never rendered (crash).** The server sends board keys named `HQ_POS`,
  `CORNER_POS`, `MID_POS`, but the client read `HQ_POSITIONS` / `MIDPOINT_POSITIONS`.
  That mismatch left `MIDPOINT_POSITIONS` undefined and crashed `drawBoard`, which
  in turn blanked the whole game screen. The client now reads both names.
- Kept the earlier `rejoin` fix that checks `ws.readyState` before sending.

## Gnomin Around
- **Mulligan: pick your own value.** When you place a Mulligan (★) face-up you now
  choose its value (3–8) via a picker, instead of the game auto-optimizing it. The
  chosen card then behaves as a positive of that value for runs/matches but stays
  marked with a ★.
- **Mulligan “one max” bug fixed.** The rule wrongly counted Mulligans that were dealt
  face-down at the start — so a player who happened to be dealt a hidden Mulligan was
  blocked from placing one they drew (the “one Mulligan max” message). It now only
  counts Mulligans you actually placed face-up. Reproduced the bug and verified the fix.
- **End-of-round score visualization.** The round-end screen now shows each player’s
  final 3×3 grid with coloured lines drawn across the runs and matches that scored, plus
  an itemized breakdown (each combo and its points) alongside the cumulative table. The
  server now sends a per-player breakdown + final-grid snapshot for this.
- **Rules / How to Play screen.** Added a “?” button in-game and a “How to Play” link on
  the lobby that open a full rules overlay covering turn flow, card values, scoring
  (matches, runs, mulligan, hazard), bounce, and round-end bonuses.
- **Runs never scored (major).** The "Runs" rule existed as a lobby toggle but was
  never implemented in the scorer — a board full of consecutive sequences scored as a
  flat sum with zero credit. Implemented run scoring: any row or column of 3
  consecutive values (e.g. 4-5-6, in any order) scores the negative of its MIDDLE
  value (4-5-6 → −5, 5-6-7 → −6). Runs and same-value matches can overlap, so a card
  may count in both a run and a crossing match. The Mulligan (★) optimizer now also
  considers runs when picking the star's best value. Verified with unit + end-to-end
  tests (the example gradient board now scores −36 before bonuses instead of +46).
- **Discard pile bug (“always goes to one pile”).** Removed logic that redirected
  your discard to the *other* pile whenever your chosen pile was empty. You can now
  start a fresh pile; cards go exactly where you put them.
- **Bounce bug (“sometimes can’t bounce when you should”).** Bounce is now offered
  whenever the displaced card’s value matches **any** other positive in your grid —
  face-up cards **or the card you just placed**. Previously the just-placed card was
  excluded from the match check, so legitimate bounces were silently denied.
  Chained bounces use the same rule.
- **Mobile layout.** The 3×4 grid is now bounded by available height (via a wrapper)
  so it can’t overflow and get cropped behind the action bar on tall phones. Center
  cards (deck/discard/hand) enlarged from 46×62 to 56×76, and the discard-choice
  sheet cards from 46×62 to 64×86 for easier tapping.
- **Reconnection.** Added a server `reconnect` handler (reattaches your socket to the
  existing player slot) plus client session persistence and auto-rejoin after a
  refresh or network blip.

## Just One
- **Security: path traversal.** The static file server did `path.join(__dirname, req.url)`
  with no containment check, so `/../server.js` or `/../../../etc/passwd` could escape
  the game directory. Added a `startsWith(root)` guard. (Already had good reconnection.)

## Azul
- **Reconnection.** Identity was stored only on the socket object, so a refresh lost
  your seat. Added per-seat tokens, a `reconnect` handler, client session persistence,
  and auto-rejoin.
- **Room cleanup bug.** The close handler deleted the room the instant all sockets
  were non-open, which would nuke games during a brief disconnect. Now a 5-minute
  grace window lets players return before cleanup.

## Compound
- **Mid-game rejoin.** The server blocked all joins once the game left the lobby, so a
  disconnected player was locked out permanently. Returning players (same `playerId`)
  can now reconnect any time; brand-new players are still lobby-only.
- **Reconnect loop hygiene.** The client now only auto-reconnects while actually in an
  active game and stops once the game is over.

## Running
Each game vendors its own `ws` module under `games/<name>/node_modules`, so they run
as-is. To run the whole collection behind one always-on service, use `hub.js` at the
root (see the hub README) and set the start command to `node hub.js`.
