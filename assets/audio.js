/**
 * Buildcave Audio — shared sound engine for all hub games.
 *
 * Solves the iOS silent-switch problem: by routing Web Audio through a muted,
 * looping <video> element (the "media channel"), sounds keep playing even when
 * the iPhone ringer switch is off — the same channel a YouTube video uses.
 *
 * Usage:
 *   <script src="/assets/audio.js"></script>
 *   BCAudio.init();              // call once; also auto-unlocks on first tap
 *   BCAudio.play('correct');     // play a named sound
 *   BCAudio.setMuted(true);      // user mute toggle
 *
 * All sounds are synthesised (no files needed) via the Web Audio API.
 */
(function () {
  let ctx = null;
  let master = null;
  let unlocked = false;
  let muted = false;


  // ── iOS media-channel unlock ──────────────────────────────────────
  // To keep the page on the "media" audio route (so the ringer switch doesn't
  // mute us), we keep a silent looping WebAudio source running. Combined with
  // resuming the context on a user gesture, this lets effects play with the
  // ringer off on most iOS versions. (Android plays regardless of the switch.)
  let keepAlive = null;
  function startKeepAlive() {
    if (!ctx || keepAlive) return;
    try {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      // near-silent low-level DC-free hum so the media session stays "active"
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.00015;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0.0015;
      src.connect(g); g.connect(ctx.destination);
      src.start();
      keepAlive = src;
    } catch (e) {}
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }

  function unlock() {
    if (unlocked) return;
    ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    startKeepAlive();
    // Prime the graph with a near-silent blip so iOS marks audio as "playing".
    try {
      const o = ctx.createOscillator(), g = ctx.createGain();
      g.gain.value = 0.0001; o.connect(g); g.connect(master);
      o.start(); o.stop(ctx.currentTime + 0.02);
    } catch (e) {}
    // Use the Media Session API where available to claim the media channel.
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
    }
    unlocked = true;
  }

  // ── Sound primitives ──────────────────────────────────────────────
  function tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.3, attack = 0.005, decay = null, slideTo = null, delay = 0 }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay || dur));
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + (decay || dur) + 0.02);
  }
  function noise({ dur = 0.2, vol = 0.2, delay = 0, filterFreq = 1000 }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + delay;
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    n.connect(f); f.connect(g); g.connect(master);
    n.start(t0); n.stop(t0 + dur);
  }

  // ── Named sound library ───────────────────────────────────────────
  const SOUNDS = {
    click:    () => tone({ freq: 600, type: 'triangle', dur: 0.05, vol: 0.16 }),
    tap:      () => tone({ freq: 420, type: 'sine', dur: 0.06, vol: 0.18 }),
    // Pleasant rising two-note confirm
    correct:  () => { tone({ freq: 660, type: 'sine', dur: 0.12, vol: 0.22 }); tone({ freq: 988, type: 'sine', dur: 0.18, vol: 0.2, delay: 0.1 }); },
    // Soft descending "nope" — not harsh
    wrong:    () => { tone({ freq: 311, type: 'triangle', dur: 0.16, vol: 0.18, slideTo: 233 }); tone({ freq: 233, type: 'triangle', dur: 0.2, vol: 0.16, delay: 0.13 }); },
    // Triumphant 4-note major arpeggio with a sparkle on top
    win:      () => { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.24, delay: i * 0.12 })); tone({ freq: 1568, type: 'sine', dur: 0.4, vol: 0.18, delay: 0.5 }); },
    // Gentle descending minor — for losing / last place
    lose:     () => { [440, 370, 294].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.32, vol: 0.2, delay: i * 0.17 })); },
    // Dice tumble: filtered noise + a settle thunk
    roll:     () => { noise({ dur: 0.22, vol: 0.13, filterFreq: 1800 }); tone({ freq: 260, type: 'triangle', dur: 0.09, vol: 0.13, delay: 0.18 }); },
    hop:      () => tone({ freq: 500, type: 'sine', dur: 0.07, vol: 0.13, slideTo: 720 }),
    pop:      () => tone({ freq: 700, type: 'sine', dur: 0.08, vol: 0.18, slideTo: 1100 }),
    whoosh:   () => noise({ dur: 0.28, vol: 0.14, filterFreq: 700 }),
    buzz:     () => { tone({ freq: 196, type: 'square', dur: 0.18, vol: 0.16 }); tone({ freq: 185, type: 'square', dur: 0.14, vol: 0.12, delay: 0.04 }); },
    ding:     () => tone({ freq: 1047, type: 'sine', dur: 0.3, vol: 0.2 }),
    // Bright two-note chime — for earning something
    chime:    () => { tone({ freq: 784, type: 'sine', dur: 0.18, vol: 0.18 }); tone({ freq: 1175, type: 'sine', dur: 0.3, vol: 0.16, delay: 0.09 }); },
    // Card sounds
    deal:     () => { noise({ dur: 0.07, vol: 0.1, filterFreq: 3500 }); },
    flip:     () => { noise({ dur: 0.09, vol: 0.11, filterFreq: 2800 }); tone({ freq: 420, type: 'triangle', dur: 0.05, vol: 0.09, delay: 0.04 }); },
    shuffle:  () => { for (let i = 0; i < 5; i++) noise({ dur: 0.05, vol: 0.07, filterFreq: 3000, delay: i * 0.05 }); },
    select:   () => tone({ freq: 520, type: 'square', dur: 0.05, vol: 0.13 }),
    countdown:() => tone({ freq: 880, type: 'sine', dur: 0.1, vol: 0.16 }),
    // Your-turn alert — gentle upward two-note
    turn:     () => { tone({ freq: 587, type: 'sine', dur: 0.1, vol: 0.16 }); tone({ freq: 880, type: 'sine', dur: 0.16, vol: 0.15, delay: 0.09 }); },
    // Single rising tick for score-count-up animations (call repeatedly)
    tick:     () => tone({ freq: 880, type: 'sine', dur: 0.04, vol: 0.1 }),
    // A point lands during the score reveal — pitch can be passed via define override
    score:    () => { tone({ freq: 660, type: 'triangle', dur: 0.08, vol: 0.14, slideTo: 990 }); },
    // Suspense riser for the lead-up to a winner reveal
    riser:    () => { const o = ensureCtx(); if (!o || muted) return; tone({ freq: 220, type: 'sawtooth', dur: 1.2, vol: 0.12, slideTo: 660 }); },
    // Big celebratory hit
    fanfare:  () => { [523, 659, 784].forEach((f,i)=>tone({freq:f,type:'square',dur:0.5,vol:0.16,delay:i*0.04})); [1047,1319].forEach((f,i)=>tone({freq:f,type:'triangle',dur:0.6,vol:0.18,delay:0.25+i*0.12})); },
  };

  // ── Optional real audio files (synthesis fallback) ────────────────
  const fileBuffers = {}, filePending = {}, fileRegistry = {};
  function loadFile(name, url) {
    ensureCtx(); if (!ctx) return;
    if (fileBuffers[name] || filePending[name]) return;
    filePending[name] = fetch(url).then(r => r.arrayBuffer())
      .then(b => ctx.decodeAudioData(b))
      .then(d => { fileBuffers[name] = d; })
      .catch(() => { delete fileRegistry[name]; }); // fall back to synth
  }
  function playFile(name) {
    const d = fileBuffers[name];
    if (!d || !ctx || muted) return false;
    const s = ctx.createBufferSource(); s.buffer = d; s.connect(master); s.start();
    return true;
  }

  // ── Public API ────────────────────────────────────────────────────
  const BCAudio = {
    init() {
      ensureCtx();
      const onGesture = () => { unlock(); };
      ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(ev =>
        window.addEventListener(ev, onGesture, { once: false, passive: true }));
      try { muted = localStorage.getItem('bc_muted') === '1'; } catch (e) {}
      return this;
    },
    play(name) {
      if (!unlocked) unlock();
      // Prefer a registered real file; otherwise synthesize.
      if (fileRegistry[name] && playFile(name)) return;
      const fn = SOUNDS[name];
      if (fn) try { fn(); } catch (e) {}
    },
    // Register a real audio file for a sound name (decoded & cached on first use).
    // BCAudio.useFile('win', '/assets/sounds/win.mp3')
    useFile(name, url) { fileRegistry[name] = url; loadFile(name, url); },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem('bc_muted', muted ? '1' : '0'); } catch (e) {}
    },
    isMuted() { return muted; },
    toggleMute() { this.setMuted(!muted); return muted; },
    setVolume(v) { if (master) master.gain.value = Math.max(0, Math.min(1, v)); },
    define(name, fn) { SOUNDS[name] = fn; },
    get ctx() { return ctx; },
  };

  if (typeof window !== 'undefined') window.BCAudio = BCAudio;
})();
