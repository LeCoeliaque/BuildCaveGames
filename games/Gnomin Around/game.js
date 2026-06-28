'use strict';

function buildDeck() {
  const cards = [];
  let id = 0;
  const pos = { 3:14, 4:14, 5:14, 6:14, 7:13, 8:13 };
  for (const [v,n] of Object.entries(pos))
    for (let i=0;i<n;i++) cards.push({ id:id++, type:'positive', value:+v });
  const neg = { '-1':6, '-2':8, '-3':5, '-4':3 };
  for (const [v,n] of Object.entries(neg))
    for (let i=0;i<n;i++) cards.push({ id:id++, type:'negative', value:+v });
  for (let i=0;i<3;i++) cards.push({ id:id++, type:'hazard',   value:10 });
  for (let i=0;i<3;i++) cards.push({ id:id++, type:'mulligan', value:0  });
  return cards;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

function makeCode(len=5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:len},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}

function scoreGrid(grid, rules={}) {
  const mulIdx = grid.findIndex(c => c.card?.type === 'mulligan');
  if (mulIdx !== -1) {
    let best = null;
    for (const v of [3,4,5,6,7,8]) {
      const tg = grid.map((c,i) => i===mulIdx ? {...c, card:{...c.card,type:'positive',value:v,_mul:true}} : c);
      const r = _scoreRaw(tg, rules);
      if (!best || r.total < best.total) best = r;
    }
    const unused = _scoreRaw(grid, rules);
    return (!best || unused.total <= best.total) ? unused : best;
  }
  return _scoreRaw(grid, rules);
}

// A line of 3 positive cards is a "run" if its values are three consecutive
// integers (in any order), e.g. 4-5-6 or 6-7-8. A run scores the negative of
// its MIDDLE value: 4-5-6 → −5, 5-6-7 → −6.
function _isRun(line) {
  if (!line.every(c => c.card?.type === 'positive')) return null;
  const vals = line.map(c => c.card.value).sort((a,b) => a-b);
  if (vals[1] === vals[0]+1 && vals[2] === vals[1]+1) {
    return { middle: vals[1], values: vals };
  }
  return null;
}

function _scoreRaw(grid, rules={}) {
  const cells = grid.map((c,i) => ({...c, row:Math.floor(i/3), col:i%3, idx:i}));
  const scored = new Set();   // cards consumed by a match or run (not scored individually)
  const breakdown = [];
  const runsOn = !!rules.runs;

  const lines = [];
  for (let r=0;r<3;r++)   lines.push({ kind:'Row', cells: cells.filter(c=>c.row===r) });
  for (let col=0;col<3;col++) lines.push({ kind:'Col', cells: cells.filter(c=>c.col===col) });

  for (const { kind, cells: line } of lines) {
    // Matches: all three the same positive value → −value bonus.
    if (line.every(c=>c.card?.type==='positive' && c.card.value===line[0].card.value)) {
      const val = line[0].card.value;
      breakdown.push({ positions: line.map(c=>c.idx), reason:`${kind} of ${val}s`, points:-val });
      line.forEach(c=>scored.add(c.idx));
      continue; // a same-value line can't also be a (distinct-value) run
    }
    // Runs: 3 consecutive values → −(middle) bonus. Cards may ALSO be claimed by
    // a crossing match/run, so we mark them scored but allow overlap freely.
    if (runsOn) {
      const run = _isRun(line);
      if (run) {
        breakdown.push({ positions: line.map(c=>c.idx), reason:`${kind} run ${run.values.join('-')}`, points:-run.middle });
        line.forEach(c=>scored.add(c.idx));
      }
    }
  }

  for (const c of cells) {
    if (scored.has(c.idx) || !c.card) continue;
    const card = c.card;
    if (card.type==='positive') breakdown.push({positions:[c.idx], reason:`${card._mul?'★→'+card.value:card.value}`, points:card.value});
    else if (card.type==='negative') breakdown.push({positions:[c.idx], reason:`${card.value}`, points:card.value});
    else if (card.type==='hazard')   breakdown.push({positions:[c.idx], reason:'Hazard', points:10});
    else if (card.type==='mulligan') breakdown.push({positions:[c.idx], reason:'Mulligan', points:0});
  }
  return { total: breakdown.reduce((s,b)=>s+b.points,0), breakdown };
}

class Game {
  constructor(id, rules={}) {
    this.id = id;
    this.rules = {
      advancedBounce:   rules.advancedBounce   ?? false,
      runs:             rules.runs             ?? false,
      advancedHazard:   rules.advancedHazard   ?? false,
      advancedMulligan: rules.advancedMulligan ?? false,
      totalRounds:      rules.totalRounds      ?? 3,
    };
    this.players            = [];
    this.state              = 'lobby'; // lobby | playing | round_end | game_over
    this.round              = 0;
    this.deck               = [];
    this.discards           = [[], []];
    this.removed            = [];
    this.currentIdx         = 0;
    this.roundEndBy         = null;
    this.finalTurnsLeft     = 0;
    this.pendingHazardFlips = {};
    this.log                = [];
    this.lastResult         = null;
  }

  addPlayer(id, name, ws) {
    if (this.players.length >= 6 || this.state !== 'lobby') return false;
    this.players.push({ id, name, ws, grid:[], scores:[], totalScore:0, drawnCard:null, pendingBounce:null });
    return true;
  }
  player(id) { return this.players.find(p=>p.id===id); }
  get cur()   { return this.players[this.currentIdx]; }

  startGame() {
    if (this.players.length < 2) return err('Need at least 2 players');
    this._startRound();
    return ok();
  }

  _startRound() {
    this.round++;
    this.state              = 'playing';
    this.roundEndBy         = null;
    this.finalTurnsLeft     = 0;
    this.removed            = [];
    this.pendingHazardFlips = {};
    this.lastResult         = null;
    this.deck               = shuffle(buildDeck());
    this.discards           = [[], []];

    for (const p of this.players) {
      p.grid          = Array.from({length:9}, () => ({ card:this.deck.pop(), faceUp:false }));
      p.drawnCard     = null;
      p.pendingBounce = null;
    }

    // Seed two discard piles, skipping hazards
    for (let i=0;i<2;i++) {
      let card = this.deck.pop();
      while (card?.type==='hazard') { this.removed.push(card); card=this.deck.pop(); }
      if (card) this.discards[i].push(card);
    }

    this._log(`Round ${this.round} begins! ${this.cur.name}'s turn.`);
  }

  drawDeck(playerId) {
    if (!this._myTurn(playerId)) return err('Not your turn');
    if (this.cur.drawnCard)      return err('Already drew');
    const card = this.deck.pop();
    if (!card) return err('Deck empty');
    this.cur.drawnCard = card;
    this._log(`${this.cur.name} drew from the deck.`);
    return ok({ card });
  }

  drawDiscard(playerId, pileIdx) {
    if (!this._myTurn(playerId))  return err('Not your turn');
    if (this.cur.drawnCard)       return err('Already drew');
    if (![0,1].includes(pileIdx)) return err('Bad pile');
    const pile = this.discards[pileIdx];
    if (!pile.length) return err('Pile empty');
    const card = pile.pop();
    this.cur.drawnCard = card;
    this._log(`${this.cur.name} took from discard ${pileIdx+1}.`);
    return ok({ card });
  }

  placeCard(playerId, gridIdx, mulliganValue) {
    if (!this._myTurn(playerId))     return err('Not your turn');
    if (!this.cur.drawnCard)         return err('No card in hand');
    if (gridIdx<0 || gridIdx>8)      return err('Bad index');
    const p        = this.cur;
    let   newCard  = p.drawnCard;
    const cell     = p.grid[gridIdx];
    const wasDown  = !cell.faceUp;
    const displaced = cell.card;

    if (newCard.type==='mulligan') {
      // Only one CHOSEN (placed face-up) mulligan is allowed per grid. A mulligan
      // that was dealt face-down does NOT count — the player never chose it.
      const hasChosenMul = p.grid.some((g,i)=>i!==gridIdx && g.faceUp && g.card?._mul);
      if (hasChosenMul) return err('Only one Mulligan allowed');
      // Player picks the value when placing it face-up (3–8). It then behaves as a
      // positive card of that value for all scoring/matching, but stays marked (★).
      const v = Number(mulliganValue);
      if (!Number.isInteger(v) || v < 3 || v > 8) return err('Pick a Mulligan value (3–8)');
      newCard = { ...newCard, type:'positive', value:v, _mul:true };
    }

    cell.card   = newCard;
    cell.faceUp = true;
    p.drawnCard = null;
    let bounceCard = null;
    if (wasDown && displaced?.type==='positive') {
      // Bounce is allowed if the displaced card's value matches ANY other
      // positive card now in the grid — face-up cards OR the card just placed.
      if (this._hasMatchingPositive(p, displaced.value, gridIdx, displaced)) {
        p.pendingBounce=displaced; bounceCard=displaced;
      }
    }
    const lastFlipped = wasDown && this._faceDownCount(p)===0;
    return ok({ displaced, wasDown, bounceCard, lastFlipped });
  }

  executeBounce(playerId, gridIdx) {
    const p = this.player(playerId);
    if (!p?.pendingBounce) return err('No bounce pending');
    const bouncedCard = p.pendingBounce;
    const cell        = p.grid[gridIdx];
    const wasDown     = !cell.faceUp;
    const displaced   = cell.card;
    if (!this.rules.advancedBounce && !wasDown) return err('Can only bounce into face-down cards');
    // The bounced card must match another positive already showing in the grid.
    const match = this._hasMatchingPositive(p, bouncedCard.value, gridIdx, null);
    if (!match) return err('No matching card in grid');
    p.pendingBounce   = null;
    cell.card   = bouncedCard;
    cell.faceUp = true;
    let nextBounce = null;
    if (wasDown && displaced?.type==='positive') {
      // Chained bounce: the newly displaced card may itself match (incl. the
      // card we just dropped into this cell).
      if (this._hasMatchingPositive(p, displaced.value, gridIdx, displaced)) {
        p.pendingBounce=displaced; nextBounce=displaced;
      }
    }
    const lastFlipped = wasDown && this._faceDownCount(p)===0;
    return ok({ displaced, nextBounce, lastFlipped });
  }

  // Does player p have a face-up positive card of `value` somewhere in the grid,
  // counting the card currently sitting at `placedIdx` (just placed, face-up)
  // but NOT counting `excludeCard` if it's the one being displaced away?
  _hasMatchingPositive(p, value, placedIdx, excludeCard) {
    return p.grid.some((g, i) => {
      if (g === excludeCard) return false;
      const c = g.card;
      if (!c || c.type !== 'positive' || c.value !== value) return false;
      // Count it if it's face-up, or if it's the card just placed at placedIdx.
      return g.faceUp || i === placedIdx;
    });
  }

  discardCard(playerId, card, pileIdx) {
    if (!this._myTurn(playerId))  return err('Not your turn');
    if (![0,1].includes(pileIdx)) return err('Bad pile');
    if (card.type==='hazard') {
      this.removed.push(card);
      const owed = {};
      for (const p of this.players) {
        if (p.id===playerId) continue;
        const fd = this._faceDownCount(p);
        const threshold = this.rules.advancedHazard ? 4 : 1;
        if (fd > threshold) {
          this.pendingHazardFlips[p.id] = (this.pendingHazardFlips[p.id]??0)+1;
          owed[p.id] = this.pendingHazardFlips[p.id];
        }
      }
      this._log(`${this.player(playerId)?.name} discarded a Hazard!`);
      this._advanceTurn();
      return ok({ hazard:true, owed });
    }
    // Discard to exactly the pile the player chose. (Empty piles are valid
    // targets — you're allowed to start a fresh pile.)
    this.discards[pileIdx].push(card);
    this._advanceTurn();
    return ok({ actualPile:pileIdx });
  }

  discardDrawn(playerId, pileIdx) {
    const p = this.player(playerId);
    if (!this._myTurn(playerId)||!p?.drawnCard) return err('Nothing to discard');
    const card = p.drawnCard;
    p.drawnCard = null;
    return this.discardCard(playerId, card, pileIdx);
  }

  flipHazard(victimId, gridIdx) {
    const owed = this.pendingHazardFlips[victimId]??0;
    if (owed<=0) return err('No flip owed');
    const p = this.player(victimId);
    if (!p) return err('Unknown player');
    if (p.grid[gridIdx].faceUp) return err('Already face-up');
    if (this._faceDownCount(p)<=1) return err('Cannot flip last card');
    p.grid[gridIdx].faceUp = true;
    this.pendingHazardFlips[victimId] = owed-1;
    if (!this.pendingHazardFlips[victimId]) delete this.pendingHazardFlips[victimId];
    this._log(`${p.name} flipped a card (Hazard).`);
    return ok();
  }

  triggerRoundEnd(playerId) {
    if (this.roundEndBy) return;
    this.roundEndBy     = playerId;
    this.finalTurnsLeft = this.players.length-1;
    this._log(`${this.player(playerId)?.name} flipped their last card — final turns!`);
    this._advanceTurn();
  }

  _advanceTurn() {
    if (this.roundEndBy) {
      this.finalTurnsLeft--;
      if (this.finalTurnsLeft<=0) { this._endRound(); return; }
    }
    this.currentIdx = (this.currentIdx+1)%this.players.length;
    if (this.roundEndBy && this.cur.id===this.roundEndBy) { this._endRound(); return; }
    this._log(`${this.cur.name}'s turn.`);
  }

  _endRound() {
    this.state = 'round_end';
    for (const p of this.players) p.grid.forEach(c=>(c.faceUp=true));
    const scores = this.players.map(p => ({ playerId:p.id, ...scoreGrid(p.grid, this.rules) }));
    const trigger = scores.find(s=>s.playerId===this.roundEndBy);
    if (trigger) {
      const othersMin = Math.min(...scores.filter(s=>s.playerId!==this.roundEndBy).map(s=>s.total));
      if (trigger.total < othersMin) {
        trigger.total -= 5;
        trigger.breakdown.push({positions:[], reason:'Went out first bonus', points:-5});
        this._log(`${this.player(this.roundEndBy)?.name} earns −5 bonus!`);
      } else {
        trigger.total += 5;
        trigger.breakdown.push({positions:[], reason:'Went out first penalty', points:+5});
        this._log(`${this.player(this.roundEndBy)?.name} gets +5 penalty.`);
      }
    }
    for (const s of scores) {
      const p = this.player(s.playerId);
      if (p) { p.scores.push(s.total); p.totalScore=p.scores.reduce((a,b)=>a+b,0); }
    }
    // Keep the per-player breakdown + final grid snapshot so the client can draw
    // the end-of-round score tally (which cards formed runs/matches, etc.).
    this.lastResult = {
      round: this.round,
      scores: scores.map(s => ({
        playerId: s.playerId,
        roundTotal: s.total,
        breakdown: s.breakdown,
        grid: this.player(s.playerId).grid.map(c => ({ faceUp:true, card:c.card })),
      })),
    };
    this.state = this.round>=this.rules.totalRounds ? 'game_over' : 'round_end';
    this._log(this.state==='game_over' ? 'Game over!' : `Round ${this.round} complete!`);
    return scores;
  }

  nextRound() {
    if (this.state!=='round_end') return err('Not at round end');
    this.currentIdx = (this.currentIdx+1)%this.players.length;
    this._startRound();
    return ok();
  }

  _myTurn(id)       { return this.state==='playing' && this.cur?.id===id; }
  _faceDownCount(p) { return p.grid.filter(c=>!c.faceUp).length; }
  _log(msg)         { this.log.push({t:Date.now(),msg}); if(this.log.length>60) this.log.shift(); }
  discardTop(i)     { return this.discards[i]?.at(-1)??null; }

  publicState(forId) {
    return {
      id:          this.id,
      state:       this.state,
      round:       this.round,
      totalRounds: this.rules.totalRounds,
      rules:       this.rules,
      currentId:   this.cur?.id??null,
      deckSize:    this.deck.length,
      discardTops: [this.discardTop(0), this.discardTop(1)],
      roundEndBy:  this.roundEndBy,
      hazardFlips: this.pendingHazardFlips,
      players: this.players.map(p => ({
        id:            p.id,
        name:          p.name,
        totalScore:    p.totalScore,
        scores:        p.scores,
        faceDownCount: this._faceDownCount(p),
        drawnCard:     p.id===forId ? p.drawnCard : (p.drawnCard?{hidden:true}:null),
        pendingBounce: p.id===forId ? p.pendingBounce : null,
        grid: p.grid.map(cell => ({
          faceUp: cell.faceUp,
          card:   (cell.faceUp || p.id===forId) ? cell.card : null,
        })),
      })),
      log: this.log.slice(-12),
      // Only present at round end / game over — drives the score-tally view.
      result: (this.state==='round_end' || this.state==='game_over') ? this.lastResult : null,
    };
  }
}

function ok(d={})  { return { ok:true,  ...d }; }
function err(msg)  { return { ok:false, error:msg }; }

module.exports = { Game, makeCode };
