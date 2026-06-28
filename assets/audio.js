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
    click:    () => tone({ freq: 600, type: 'triangle', dur: 0.05, vol: 0.18 }),
    tap:      () => tone({ freq: 420, type: 'sine', dur: 0.06, vol: 0.2 }),
    correct:  () => { tone({ freq: 660, type: 'sine', dur: 0.12, vol: 0.25 }); tone({ freq: 880, type: 'sine', dur: 0.16, vol: 0.22, delay: 0.1 }); },
    wrong:    () => { tone({ freq: 200, type: 'sawtooth', dur: 0.18, vol: 0.22, slideTo: 120 }); tone({ freq: 150, type: 'sawtooth', dur: 0.16, vol: 0.18, delay: 0.12 }); },
    win:      () => { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.25, vol: 0.25, delay: i * 0.11 })); },
    lose:     () => { [392, 330, 262].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.3, vol: 0.22, delay: i * 0.16 })); },
    roll:     () => { noise({ dur: 0.18, vol: 0.12, filterFreq: 2000 }); tone({ freq: 300, type: 'triangle', dur: 0.08, vol: 0.12, delay: 0.05 }); },
    hop:      () => tone({ freq: 500, type: 'sine', dur: 0.07, vol: 0.14, slideTo: 700 }),
    pop:      () => tone({ freq: 800, type: 'sine', dur: 0.08, vol: 0.2, slideTo: 1200 }),
    whoosh:   () => noise({ dur: 0.25, vol: 0.15, filterFreq: 800 }),
    buzz:     () => tone({ freq: 180, type: 'square', dur: 0.25, vol: 0.2 }),
    ding:     () => tone({ freq: 1047, type: 'sine', dur: 0.3, vol: 0.22 }),
    chime:    () => { tone({ freq: 784, type: 'sine', dur: 0.2, vol: 0.18 }); tone({ freq: 1047, type: 'sine', dur: 0.3, vol: 0.16, delay: 0.08 }); },
    deal:     () => { noise({ dur: 0.08, vol: 0.1, filterFreq: 3000 }); },
    flip:     () => { noise({ dur: 0.1, vol: 0.12, filterFreq: 2500 }); tone({ freq: 400, type: 'triangle', dur: 0.06, vol: 0.1, delay: 0.04 }); },
    select:   () => tone({ freq: 520, type: 'square', dur: 0.05, vol: 0.14 }),
    countdown:() => tone({ freq: 880, type: 'sine', dur: 0.1, vol: 0.18 }),
    turn:     () => { tone({ freq: 587, type: 'sine', dur: 0.1, vol: 0.18 }); tone({ freq: 784, type: 'sine', dur: 0.14, vol: 0.16, delay: 0.08 }); },
  };

  // ── Public API ────────────────────────────────────────────────────
  const BCAudio = {
    init() {
      ensureCtx();
      // Unlock on the first user interaction of any kind.
      const onGesture = () => { unlock(); };
      ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(ev =>
        window.addEventListener(ev, onGesture, { once: false, passive: true }));
      // Persisted mute preference
      try { muted = localStorage.getItem('bc_muted') === '1'; } catch (e) {}
      return this;
    },
    play(name) {
      if (!unlocked) unlock();
      const fn = SOUNDS[name];
      if (fn) try { fn(); } catch (e) {}
    },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem('bc_muted', muted ? '1' : '0'); } catch (e) {}
    },
    isMuted() { return muted; },
    toggleMute() { this.setMuted(!muted); return muted; },
    setVolume(v) { if (master) master.gain.value = Math.max(0, Math.min(1, v)); },
    // Let games register custom sounds: BCAudio.define('explode', () => ...)
    define(name, fn) { SOUNDS[name] = fn; },
    get ctx() { return ctx; },
  };

  if (typeof window !== 'undefined') window.BCAudio = BCAudio;
})();
