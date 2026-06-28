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
    .bcc-stage{display:flex;flex-direction:column;gap:.5rem;width:100%;max-width:520px;margin:0 auto;}
    .bcc-title{text-align:center;font-weight:800;font-size:1.1rem;letter-spacing:-.01em;opacity:0;transform:translateY(8px);transition:opacity .4s,transform .4s;}
    .bcc-title.in{opacity:1;transform:none;}
    .bcc-row{position:relative;display:flex;align-items:center;gap:.7rem;padding:.6rem .8rem;border-radius:10px;
      background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);overflow:hidden;
      opacity:0;transform:translateY(18px) scale(.96);}
    .bcc-row.in{opacity:1;transform:none;transition:opacity .45s cubic-bezier(.34,1.56,.64,1),transform .45s cubic-bezier(.34,1.56,.64,1);}
    .bcc-fill{position:absolute;inset:0;width:0;background:linear-gradient(90deg,rgba(255,255,255,.10),rgba(255,255,255,.02));z-index:0;transition:width 1s cubic-bezier(.4,0,.2,1);}
    .bcc-row>*{position:relative;z-index:1;}
    .bcc-rank{font-family:ui-monospace,monospace;font-weight:800;width:1.6rem;text-align:center;opacity:.7;}
    .bcc-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;box-shadow:0 0 0 2px rgba(255,255,255,.15);}
    .bcc-name{flex:1;font-weight:700;}
    .bcc-score{font-family:ui-monospace,monospace;font-weight:800;font-size:1.05rem;}
    .bcc-row.winner{border-color:#f0c040;box-shadow:0 0 0 1px #f0c040,0 6px 24px rgba(240,192,64,.25);}
    .bcc-row.winner .bcc-fill{background:linear-gradient(90deg,rgba(240,192,64,.35),rgba(240,192,64,.05));}
    .bcc-crown{position:absolute;right:.8rem;top:50%;transform:translateY(-50%) scale(0);font-size:1.2rem;z-index:2;transition:transform .5s cubic-bezier(.34,1.56,.64,1);}
    .bcc-row.winner .bcc-crown{transform:translateY(-50%) scale(1);}
    @keyframes bccWinPulse{0%,100%{box-shadow:0 0 0 1px #f0c040,0 6px 24px rgba(240,192,64,.25)}50%{box-shadow:0 0 0 2px #f0c040,0 8px 36px rgba(240,192,64,.5)}}
    .bcc-row.winner.pulse{animation:bccWinPulse 1.2s ease-in-out 2;}
    @keyframes bccConfFall{to{transform:translateY(110vh) rotate(720deg);opacity:0}}
    .bcc-banner{text-align:center;font-size:1.5rem;font-weight:900;letter-spacing:-.02em;opacity:0;transform:scale(.6) rotate(-6deg);}
    .bcc-banner.in{opacity:1;transform:none;transition:opacity .5s,transform .6s cubic-bezier(.34,1.56,.64,1);}
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
    const colors = opts.colors || ['#e74c3c','#3498db','#27ae60','#f1c40f','#9b59b6','#1abc9c','#e67e22','#e91e63'];
    const count = opts.count || 80;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998;overflow:hidden';
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      const size = 6 + Math.random() * 9;
      const dur = 1.8 + Math.random() * 1.8;
      c.style.cssText = `position:absolute;top:-24px;left:${Math.random()*100}%;width:${size}px;height:${size}px;`+
        `background:${colors[i%colors.length]};border-radius:${Math.random()>.5?'50%':'2px'};`+
        `transform:rotate(${Math.random()*360}deg);animation:bccConfFall ${dur}s ${Math.random()*0.6}s ease-in forwards`;
      wrap.appendChild(c);
    }
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), (opts.lifetime || 4200));
  }

  function popIn(el) {
    el.classList.remove('bcc-banner'); void el.offsetWidth;
    el.classList.add('bcc-banner'); requestAnimationFrame(() => el.classList.add('in'));
  }

  // The full staged ending sequence.
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

    // Build rows in rank order but reveal lowest-first for suspense.
    const rows = players.map((p, i) => {
      const row = document.createElement('div');
      row.className = 'bcc-row' + (i === 0 ? ' winner' : '');
      row.innerHTML =
        `<div class="bcc-fill"></div>`+
        `<span class="bcc-rank">${i + 1}</span>`+
        `<span class="bcc-dot" style="background:${p.color || '#888'}"></span>`+
        `<span class="bcc-name">${escapeHtml(p.name || '')}</span>`+
        `<span class="bcc-score">0</span>`+
        (i === 0 ? `<span class="bcc-crown">👑</span>` : '');
      stage.appendChild(row);
      return { row, p, rank: i };
    });
    container.appendChild(stage);

    // Sequence timing
    let t = 0;
    setTimeout(() => title.classList.add('in'), (t += 200));
    snd('riser');

    // Reveal from last place up to 2nd, then a beat, then the winner.
    const revealOrder = rows.slice().reverse(); // lowest first
    const stepGap = 750;
    revealOrder.forEach((entry, idx) => {
      const isWinner = entry.rank === 0;
      const delay = (t += (isWinner ? stepGap + 500 : stepGap));
      setTimeout(() => {
        entry.row.classList.add('in');
        const fill = entry.row.querySelector('.bcc-fill');
        const scoreEl = entry.row.querySelector('.bcc-score');
        fill.style.width = Math.round(((entry.p.score || 0) / maxScore) * 100) + '%';
        snd(isWinner ? 'fanfare' : 'score');
        countUp(scoreEl, 0, entry.p.score || 0, 800, () => { if (!isWinner && Math.random() < 0.4) snd('tick'); });
        if (isWinner) {
          entry.row.classList.add('pulse');
          confetti();
          // Winner banner
          if (opts.winnerLabel) {
            const banner = document.createElement('div');
            banner.className = 'bcc-banner';
            banner.style.marginTop = '.6rem';
            banner.textContent = opts.winnerLabel(winner.name);
            stage.appendChild(banner);
            setTimeout(() => { banner.classList.add('in'); }, 300);
          }
          setTimeout(() => { if (opts.onDone) opts.onDone(); }, 1400);
        }
      }, delay);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
  }

  const BCCelebrate = { ending, confetti, countUp, popIn };
  if (typeof window !== 'undefined') window.BCCelebrate = BCCelebrate;
})();
