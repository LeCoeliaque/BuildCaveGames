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

function scoreGrid(grid) {
  const mulIdx = grid.findIndex(c => c.card?.type === 'mulligan');
  if (mulIdx !== -1) {
    let best = null;
    for (const v of [3,4,5,6,7,8]) {
      const tg = grid.map((c,i) => i===mulIdx ? {...c, card:{...c.card,type:'positive',value:v,_mul:true}} : c);
      const r = _scoreRaw(tg);
      if (!best || r.total < best.total) best = r;
    }
    const unused = _scoreRaw(grid);
    return (!best || unused.total <= best.total) ? unused : best;
  }
  return _scoreRaw(grid);
}

function _scoreRaw(grid) {
  const cells = grid.map((c,i) => ({...c, row:Math.floor(i/3), col:i%3, idx:i}));
  const inSet = new Set();
  const breakdown = [];
  for (let r=0;r<3;r++) {
    const row = cells.filter(c=>c.row===r);
    if (row.every(c=>c.card?.type==='positive' && c.card.value===row[0].card.value)) {
      const val = row[0].card.value;
      breakdown.push({positions:row.map(c=>c.idx), reason:`Row of ${val}s`, points:-val});
      row.forEach(c=>inSet.add(c.idx));
    }
  }
  for (let col=0;col<3;col++) {
    const column = cells.filter(c=>c.col===col);
    if (column.every(c=>c.card?.type==='positive' && c.card.value===column[0].card.value)) {
      const val = column[0].card.value;
      breakdown.push({positions:column.map(c=>c.idx), reason:`Col of ${val}s`, points:-val});
      column.forEach(c=>inSet.add(c.idx));
    }
  }
  for (const c of cells) {
    if (inSet.has(c.idx) || !c.card) continue;
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

  placeCard(playerId, gridIdx) {
    if (!this._myTurn(playerId))     return err('Not your turn');
    if (!this.cur.drawnCard)         return err('No card in hand');
    if (gridIdx<0 || gridIdx>8)      return err('Bad index');
    const p        = this.cur;
    const newCard  = p.drawnCard;
    const cell     = p.grid[gridIdx];
    const wasDown  = !cell.faceUp;
    const displaced = cell.card;
    if (newCard.type==='mulligan') {
      const hasMul = p.grid.some((g,i)=>i!==gridIdx && g.card?.type==='mulligan');
      if (hasMul) return err('Only one Mulligan allowed');
    }
    cell.card   = newCard;
    cell.faceUp = true;
    p.drawnCard = null;
    let bounceCard = null;
    if (wasDown && displaced?.type==='positive') {
      // Bounce only allowed if displaced card matches a face-up positive card already in the grid
      const match = p.grid.some((g,i)=>i!==gridIdx && g.faceUp && g.card?.type==='positive' && g.card.value===displaced.value);
      if (match) { p.pendingBounce=displaced; bounceCard=displaced; }
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
    p.pendingBounce   = null;
    if (!this.rules.advancedBounce && !wasDown) return err('Can only bounce into face-down cards');
    const match = p.grid.some((g,i)=>i!==gridIdx && g.faceUp && g.card?.type==='positive' && g.card.value===bouncedCard.value);
    if (!match) return err('No matching card in grid');
    cell.card   = bouncedCard;
    cell.faceUp = true;
    let nextBounce = null;
    if (wasDown && displaced?.type==='positive') {
      const m2 = p.grid.some((g,i)=>i!==gridIdx && g.faceUp && g.card?.type==='positive' && g.card.value===displaced.value);
      if (m2) { p.pendingBounce=displaced; nextBounce=displaced; }
    }
    const lastFlipped = wasDown && this._faceDownCount(p)===0;
    return ok({ displaced, nextBounce, lastFlipped });
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
    const target = (!this.discards[pileIdx].length && this.discards[1-pileIdx].length) ? 1-pileIdx : pileIdx;
    this.discards[target].push(card);
    this._advanceTurn();
    return ok({ actualPile:target });
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
    const scores = this.players.map(p => ({ playerId:p.id, ...scoreGrid(p.grid) }));
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
    };
  }
}

function ok(d={})  { return { ok:true,  ...d }; }
function err(msg)  { return { ok:false, error:msg }; }

module.exports = { Game, makeCode };
