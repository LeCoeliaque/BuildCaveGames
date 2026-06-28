/**
 * Buildcave Celebrate — shared dramatic ending + reveal animations for hub games.
 *
 * <script src="/assets/celebrate.js"></script>
 *
 * BCCelebrate.ending(container, {
 *   players: [{ name, score, color }],   // any order; sorted by score desc
 *   title: 'Final Scores',
 *   winnerLabel: name => `${name} wins!`, // optional
 *   onDone: () => {},                     // called after the sequence finishes
 * });
 *
 * Produces a staged reveal: suspense pause → bars rise from the bottom one rank at a
 * time (lowest first) with score count-up and ticks → winner bar pulses gold →
 * confetti + fanfare. Uses BCAudio if present.
 *
 * Also exposes small reveal helpers:
 *   BCCelebrate.confetti(opts)
 *   BCCelebrate.countUp(el, from, to, ms, onTick)
 *   BCCelebrate.popIn(el)
 */
(function () {
  const A = () => (typeof window !== 'undefined' ? window.BCAudio : null);
  function snd(name) { const a = A(); if (a) try { a.play(name); } catch (e) {} }

  // Inject base styles once.
  let injected = false;
  function ensureStyles() {
    if (injected) return; injected = true;
    const css = `
    .bcc-stage{display:flex;flex-direction:column;gap:1rem;width:100%;max-width:560px;margin:0 auto;align-items:center;}
    .bcc-title{text-align:center;font-weight:800;font-size:1.2rem;letter-spacing:-.01em;opacity:0;transform:translateY(8px);transition:opacity .5s,transform .5s;}
    .bcc-title.in{opacity:1;transform:none;}

    /* Vertical bar-graph chart */
    .bcc-chart{display:flex;align-items:flex-end;justify-content:center;gap:clamp(.4rem,3vw,1.4rem);
      height:300px;width:100%;padding:0 .5rem;}
    .bcc-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
      flex:1;max-width:90px;height:100%;position:relative;padding-top:2.6rem;}
    .bcc-col-score{font-family:ui-monospace,monospace;font-weight:800;font-size:1.1rem;margin-bottom:.35rem;
      opacity:0;transform:translateY(6px);transition:opacity .3s,transform .3s;}
    .bcc-col-score.in{opacity:1;transform:none;}
    .bcc-bar{width:100%;border-radius:8px 8px 0 0;height:0;position:relative;
      transition:height 1.3s cubic-bezier(.22,1,.36,1);
      box-shadow:inset 0 2px 8px rgba(255,255,255,.15);}
    .bcc-bar-glow{position:absolute;inset:0;border-radius:8px 8px 0 0;opacity:0;}
    .bcc-col.winner .bcc-bar{box-shadow:inset 0 2px 8px rgba(255,255,255,.25),0 0 24px rgba(240,192,64,.5);}
    .bcc-crown{position:absolute;top:0;left:50%;transform:translateX(-50%) scale(0) translateY(10px);
      font-size:1.8rem;transition:transform .6s cubic-bezier(.34,1.56,.64,1);filter:drop-shadow(0 2px 6px rgba(240,192,64,.6));}
    .bcc-col.winner .bcc-crown{transform:translateX(-50%) scale(1) translateY(0);}
    .bcc-col-base{margin-top:.5rem;display:flex;flex-direction:column;align-items:center;gap:.25rem;
      opacity:0;transform:translateY(8px);transition:opacity .4s,transform .4s;}
    .bcc-col-base.in{opacity:1;transform:none;}
    .bcc-dot{width:14px;height:14px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.15);}
    .bcc-name{font-weight:700;font-size:.82rem;text-align:center;max-width:90px;overflow:hidden;
      text-overflow:ellipsis;white-space:nowrap;}
    .bcc-rank{font-family:ui-monospace,monospace;font-size:.7rem;opacity:.55;font-weight:700;}

    @keyframes bccWinPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.35)}}
    .bcc-col.winner.pulse .bcc-bar{animation:bccWinPulse 1s ease-in-out 3;}
    @keyframes bccConfFall{to{transform:translateY(110vh) rotate(720deg);opacity:0}}
    @keyframes bccConfSpin{to{transform:translateY(110vh) rotateX(720deg) rotateY(360deg);opacity:0}}
    .bcc-banner{text-align:center;font-size:1.7rem;font-weight:900;letter-spacing:-.02em;
      opacity:0;transform:scale(.5) rotate(-8deg);}
    .bcc-banner.in{opacity:1;transform:none;transition:opacity .6s,transform .7s cubic-bezier(.34,1.56,.64,1);}
    `;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }

  function countUp(el, from, to, ms, onTick) {
    const start = performance.now();
    const diff = to - from;
    function frame(now) {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(from + diff * eased);
      el.textContent = val;
      if (onTick) onTick(val);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function confetti(opts) {
    opts = opts || {};
    const colors = opts.colors || ['#e74c3c','#3498db','#27ae60','#f1c40f','#9b59b6','#1abc9c','#e67e22','#e91e63','#f0c040','#ffffff'];
    const count = opts.count || 90;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998;overflow:hidden';
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      const size = 7 + Math.random() * 10;
      const dur = 3.2 + Math.random() * 2.8;          // slower, longer fall
      const spin = Math.random() > 0.5;
      const anim = spin ? 'bccConfSpin' : 'bccConfFall';
      c.style.cssText = `position:absolute;top:-30px;left:${Math.random()*100}%;width:${size}px;height:${size*(0.6+Math.random()*0.8)}px;`+
        `background:${colors[i%colors.length]};border-radius:${Math.random()>.5?'50%':'2px'};`+
        `transform:rotate(${Math.random()*360}deg);animation:${anim} ${dur}s ${Math.random()*1.2}s cubic-bezier(.3,.1,.5,1) forwards`;
      wrap.appendChild(c);
    }
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), (opts.lifetime || 7000));   // longer-lived
  }

  function popIn(el) {
    el.classList.remove('bcc-banner'); void el.offsetWidth;
    el.classList.add('bcc-banner'); requestAnimationFrame(() => el.classList.add('in'));
  }

  // The full staged ending sequence — a rising vertical bar chart.
  function ending(container, opts) {
    ensureStyles();
    const players = [...(opts.players || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
    if (!players.length) { if (opts.onDone) opts.onDone(); return; }
    const maxScore = Math.max(1, ...players.map(p => p.score || 0));
    const winner = players[0];

    container.innerHTML = '';
    const stage = document.createElement('div'); stage.className = 'bcc-stage';
    const title = document.createElement('div'); title.className = 'bcc-title';
    title.textContent = opts.title || 'Final Scores';
    stage.appendChild(title);

    // Chart with one column per player, displayed left-to-right by rank.
    const chart = document.createElement('div'); chart.className = 'bcc-chart';
    const cols = players.map((p, i) => {
      const col = document.createElement('div');
      col.className = 'bcc-col' + (i === 0 ? ' winner' : '');
      col.innerHTML =
        `<div class="bcc-crown">👑</div>`+
        `<div class="bcc-col-score">0</div>`+
        `<div class="bcc-bar" style="background:linear-gradient(180deg,${lighten(p.color || '#7c3aed', 40)},${p.color || '#7c3aed'})"></div>`+
        `<div class="bcc-col-base">`+
          `<div class="bcc-dot" style="background:${p.color || '#888'}"></div>`+
          `<div class="bcc-name">${escapeHtml(p.name || '')}</div>`+
          `<div class="bcc-rank">#${i + 1}</div>`+
        `</div>`;
      chart.appendChild(col);
      return { col, p, rank: i };
    });
    stage.appendChild(chart);
    container.appendChild(stage);

    // ── Drawn-out sequence ──
    let t = 0;
    const RISE = 1300;        // bar grow duration (matches CSS transition)
    const GAP_NORMAL = 1300;  // pause between non-winner reveals
    const GAP_BEFORE_WIN = 1800;

    setTimeout(() => title.classList.add('in'), (t += 400));
    t += 600;
    setTimeout(() => snd('riser'), t);

    // Reveal lowest rank first, winner last.
    const order = cols.slice().reverse();
    order.forEach((entry) => {
      const isWinner = entry.rank === 0;
      const delay = (t += (isWinner ? GAP_BEFORE_WIN : GAP_NORMAL));
      setTimeout(() => {
        // Show base label
        const base = entry.col.querySelector('.bcc-col-base');
        base.classList.add('in');
        // Grow the bar
        const bar = entry.col.querySelector('.bcc-bar');
        const heightPct = Math.max(4, Math.round(((entry.p.score || 0) / maxScore) * 100));
        bar.style.height = heightPct + '%';
        // Count the score up as the bar grows, with rising ticks
        const scoreEl = entry.col.querySelector('.bcc-col-score');
        setTimeout(() => scoreEl.classList.add('in'), 150);
        let lastTick = 0;
        countUp(scoreEl, 0, entry.p.score || 0, RISE, (val) => {
          if (val !== lastTick && val % Math.max(1, Math.round((entry.p.score||1)/8)) === 0) { snd('tick'); lastTick = val; }
        });
        snd(isWinner ? 'fanfare' : 'score');

        if (isWinner) {
          setTimeout(() => {
            entry.col.classList.add('pulse');
            // Multiple confetti bursts over time for a sustained celebration
            confetti({ count: 90 });
            setTimeout(() => confetti({ count: 70 }), 700);
            setTimeout(() => confetti({ count: 70 }), 1500);
            if (opts.winnerLabel) {
              const banner = document.createElement('div');
              banner.className = 'bcc-banner';
              banner.textContent = opts.winnerLabel(winner.name);
              stage.appendChild(banner);
              requestAnimationFrame(() => banner.classList.add('in'));
            }
            setTimeout(() => { if (opts.onDone) opts.onDone(); }, 2200);
          }, RISE * 0.5);
        }
      }, delay);
    });
  }

  function lighten(hex, amt) {
    if (!hex || hex[0] !== '#' || hex.length < 7) return hex;
    let r = Math.min(255, parseInt(hex.slice(1,3),16) + amt);
    let g = Math.min(255, parseInt(hex.slice(3,5),16) + amt);
    let b = Math.min(255, parseInt(hex.slice(5,7),16) + amt);
    return `rgb(${r},${g},${b})`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
  }

  const BCCelebrate = { ending, confetti, countUp, popIn };
  if (typeof window !== 'undefined') window.BCCelebrate = BCCelebrate;
})();
