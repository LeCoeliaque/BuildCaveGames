#!/usr/bin/env node
/**
 * TriviaWheel Question Screener (fast, in-memory)
 *
 * Run from inside the TriviaWheel game folder:
 *     node screener.js
 * Then open http://localhost:4500
 *
 * Loads all questions once into memory; Keep/Remove is instant. Removals flush to
 * the JSON files (debounced) with a one-time .bak backup, and are archived to
 * ./screened_out.json. Progress is saved to ./screener_progress.json (resume any time).
 *
 * Keyboard: → / K = keep · ← / X = remove · U = undo last.
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4500;
const ROOT = __dirname;
const FR_DIR = path.join(ROOT, 'categories');
const MC_DIR = path.join(ROOT, 'categories_mc');
const PROGRESS_FILE = path.join(ROOT, 'screener_progress.json');
const REMOVED_FILE  = path.join(ROOT, 'screened_out.json');

const stripPrefix = raw => raw.replace(/^\d+[-_]?/, '').replace(/\.json$/, '');
const listFiles = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort() : [];
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } };

const files = {};   // fileKey -> { dir, file, type, catLabel, arr, dirty }
let order = [];      // [{ fileKey, key, q }]
let progress = readJson(PROGRESS_FILE, { reviewed:{} });

const keyFor = (type, catLabel, q) =>
  `${type}:${catLabel}:${q ? (q.Question||q.question||'') : ''}`.slice(0,200);

function loadAll(){
  for (const f of listFiles(FR_DIR))
    files['fr:'+f] = { dir:FR_DIR, file:f, type:'fr', catLabel:stripPrefix(f), arr:readJson(path.join(FR_DIR,f),[]), dirty:false };
  for (const f of listFiles(MC_DIR))
    files['mc:'+f] = { dir:MC_DIR, file:f, type:'mc', catLabel:stripPrefix(f), arr:readJson(path.join(MC_DIR,f),[]), dirty:false };
  order = [];
  for (const fk of Object.keys(files)) {
    const fo = files[fk];
    fo.arr.forEach(q => order.push({ fileKey:fk, key:keyFor(fo.type,fo.catLabel,q), q }));
  }
}

let flushTimer=null;
function scheduleFlush(){ clearTimeout(flushTimer); flushTimer=setTimeout(flushNow,400); }
function flushNow(){
  for (const fk of Object.keys(files)) {
    const fo = files[fk]; if (!fo.dirty) continue;
    const fp = path.join(fo.dir, fo.file), bak = fp+'.bak';
    if (!fs.existsSync(bak)) { try { fs.copyFileSync(fp,bak); } catch {} }
    try { fs.writeFileSync(fp, JSON.stringify(fo.arr,null,2)); fo.dirty=false; }
    catch(e){ console.error('flush failed', fo.file, e.message); }
  }
}
let progTimer=null;
function saveProgress(){ clearTimeout(progTimer); progTimer=setTimeout(()=>{ try{fs.writeFileSync(PROGRESS_FILE,JSON.stringify(progress,null,2));}catch{} },400); }
function archiveRemoved(q, fo){
  const removed = readJson(REMOVED_FILE, []);
  removed.push({ ...q, _file:fo.file, _type:fo.type, _removedAt:new Date().toISOString() });
  try { fs.writeFileSync(REMOVED_FILE, JSON.stringify(removed,null,2)); } catch {}
}

function nextEntry(cat, type){
  for (let i=0;i<order.length;i++){
    const o = order[i]; if (progress.reviewed[o.key]) continue;
    const fo = files[o.fileKey];
    if (cat && fo.catLabel!==cat) continue;
    if (type && fo.type!==type) continue;
    return { o, fo };
  }
  return null;
}
function totals(cat, type){
  let scoped=0, remaining=0;
  for (const o of order){
    const fo = files[o.fileKey];
    if (cat && fo.catLabel!==cat) continue;
    if (type && fo.type!==type) continue;
    scoped++; if (!progress.reviewed[o.key]) remaining++;
  }
  const reviewed = Object.keys(progress.reviewed).length;
  const removed = Object.values(progress.reviewed).filter(v=>v==='remove').length;
  return { total: order.length + removed, scopedTotal: scoped, reviewed, removed, remaining };
}
const allCats = () => [...new Set(order.map(o=>files[o.fileKey].catLabel))];

const server = http.createServer((req,res)=>{
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/'){ res.writeHead(200,{'Content-Type':'text/html'}); res.end(PAGE); return; }

  if (url.pathname === '/api/state'){
    const cat=url.searchParams.get('cat')||'', type=url.searchParams.get('type')||'';
    const ne = nextEntry(cat,type);
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({
      totals: totals(cat,type), cats: allCats(),
      entry: ne ? { fileKey:ne.o.fileKey, key:ne.o.key, type:ne.fo.type, catLabel:ne.fo.catLabel } : null,
      question: ne ? ne.o.q : null,
    }));
    return;
  }

  if (url.pathname === '/api/decide' && req.method==='POST'){
    let b=''; req.on('data',d=>b+=d); req.on('end',()=>{
      let data; try{ data=JSON.parse(b);}catch{ res.writeHead(400);res.end('{}');return; }
      const { key, fileKey, decision } = data;
      progress.reviewed[key] = decision;
      if (decision==='remove'){
        const fo = files[fileKey];
        if (fo){
          const i = fo.arr.findIndex(q=>keyFor(fo.type,fo.catLabel,q)===key);
          if (i!==-1){ const [q]=fo.arr.splice(i,1); fo.dirty=true; archiveRemoved(q,fo); scheduleFlush(); }
        }
        const oi = order.findIndex(o=>o.key===key);
        if (oi!==-1) order.splice(oi,1);
      }
      saveProgress();
      res.writeHead(200,{'Content-Type':'application/json'}); res.end('{"ok":true}');
    });
    return;
  }

  if (url.pathname === '/api/undo' && req.method==='POST'){
    let b=''; req.on('data',d=>b+=d); req.on('end',()=>{
      let data; try{ data=JSON.parse(b);}catch{ res.writeHead(400);res.end('{}');return; }
      const { key, fileKey, question, wasRemoved } = data;
      delete progress.reviewed[key];
      if (wasRemoved && question){
        const fo = files[fileKey];
        if (fo){
          fo.arr.push(question); fo.dirty=true; scheduleFlush();
          order.push({ fileKey, key, q:question });
          const removed = readJson(REMOVED_FILE, []);
          for (let i=removed.length-1;i>=0;i--)
            if ((removed[i].Question||removed[i].question)===(question.Question||question.question) && removed[i]._file===fo.file){ removed.splice(i,1); break; }
          try { fs.writeFileSync(REMOVED_FILE, JSON.stringify(removed,null,2)); } catch {}
        }
      }
      saveProgress();
      res.writeHead(200,{'Content-Type':'application/json'}); res.end('{"ok":true}');
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

loadAll();
server.listen(PORT, ()=>{
  console.log(`\n  TriviaWheel Question Screener`);
  console.log(`  ${order.length} questions across ${allCats().length} categories`);
  console.log(`  → open http://localhost:${PORT}\n`);
});
process.on('SIGINT', ()=>{ flushNow(); process.exit(0); });
process.on('SIGTERM',()=>{ flushNow(); process.exit(0); });

const PAGE = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TriviaWheel Question Screener</title>
<style>
  :root{--bg:#0a0e14;--surf:#141a23;--surf2:#1e2530;--bdr:#2a3441;--txt:#e6edf3;--muted:#8b97a5;--green:#16a34a;--red:#dc2626;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--txt);min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:1.5rem 1rem;}
  .wrap{width:100%;max-width:680px;}
  h1{font-size:1.1rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.2rem;}
  .sub{color:var(--muted);font-size:.82rem;margin-bottom:1rem;}
  .bar{height:8px;background:var(--surf2);border-radius:99px;overflow:hidden;margin-bottom:.4rem;}
  .bar>div{height:100%;background:linear-gradient(90deg,#7c3aed,#60a5fa);transition:width .3s;}
  .stats{display:flex;gap:1rem;font-size:.76rem;color:var(--muted);margin-bottom:1rem;flex-wrap:wrap;}
  .stats b{color:var(--txt);}
  .filters{display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap;}
  select{background:var(--surf2);color:var(--txt);border:1px solid var(--bdr);border-radius:8px;padding:.4rem .6rem;font-size:.82rem;font-family:inherit;}
  .card{background:var(--surf);border:1px solid var(--bdr);border-radius:14px;padding:1.4rem;min-height:200px;display:flex;flex-direction:column;gap:1rem;box-shadow:0 8px 30px rgba(0,0,0,.3);}
  .meta{display:flex;align-items:center;gap:.5rem;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
  .badge{padding:.18rem .55rem;border-radius:20px;font-weight:700;font-size:.66rem;}
  .badge.fr{background:#1e3a5f;color:#93c5fd;}
  .badge.mc{background:#451a7a;color:#c4b5fd;}
  .qtext{font-size:1.15rem;font-weight:600;line-height:1.5;}
  .answer{font-size:.95rem;color:var(--green);font-weight:700;padding:.6rem .8rem;background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.25);border-radius:8px;}
  .opts{display:flex;flex-direction:column;gap:.4rem;}
  .opt{display:flex;gap:.6rem;align-items:flex-start;padding:.5rem .7rem;background:var(--surf2);border:1px solid var(--bdr);border-radius:8px;font-size:.9rem;}
  .opt.correct{border-color:var(--green);background:rgba(22,163,74,.1);}
  .opt .L{font-family:ui-monospace,monospace;font-weight:700;width:1.4rem;height:1.4rem;display:flex;align-items:center;justify-content:center;background:var(--bdr);border-radius:5px;flex-shrink:0;font-size:.78rem;}
  .opt.correct .L{background:var(--green);color:#fff;}
  .actions{display:flex;gap:.7rem;margin-top:1rem;}
  .btn{flex:1;padding:.95rem;border:none;border-radius:11px;font-size:.95rem;font-weight:800;cursor:pointer;font-family:inherit;transition:transform .1s,filter .15s;}
  .btn:active{transform:scale(.97);}
  .btn.keep{background:var(--green);color:#fff;}
  .btn.remove{background:var(--red);color:#fff;}
  .btn.undo{flex:0 0 auto;background:var(--surf2);color:var(--muted);border:1px solid var(--bdr);}
  .btn:hover{filter:brightness(1.1);}
  .hint{text-align:center;color:var(--muted);font-size:.72rem;margin-top:.8rem;}
  .done{text-align:center;padding:3rem 1rem;font-size:1.1rem;color:var(--muted);}
  .toast{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:var(--surf2);border:1px solid var(--bdr);padding:.6rem 1rem;border-radius:10px;font-size:.82rem;opacity:0;transition:opacity .2s;pointer-events:none;}
  .toast.show{opacity:1;}
</style></head>
<body>
<div class="wrap">
  <h1>🎡 TriviaWheel Question Screener</h1>
  <div class="sub">Review questions one at a time. Removals save instantly (with backups).</div>
  <div class="bar"><div id="prog" style="width:0%"></div></div>
  <div class="stats">
    <span>Reviewed <b id="s-rev">0</b></span>
    <span>Removed <b id="s-rem">0</b></span>
    <span>Remaining <b id="s-left">0</b></span>
    <span>Total <b id="s-tot">0</b></span>
  </div>
  <div class="filters">
    <select id="f-cat"><option value="">All categories</option></select>
    <select id="f-type">
      <option value="">Both types</option>
      <option value="fr">Free response</option>
      <option value="mc">Multiple choice</option>
    </select>
  </div>
  <div id="content"></div>
</div>
<div class="toast" id="toast"></div>

<script>
let cur=null, curQ=null, lastAction=null;
const $ = id => document.getElementById(id);
function toast(t){ const el=$('toast'); el.textContent=t; el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),1100); }

async function load(){
  const cat=$('f-cat').value, type=$('f-type').value;
  const r = await fetch('/api/state?cat='+encodeURIComponent(cat)+'&type='+encodeURIComponent(type));
  const data = await r.json();
  if ($('f-cat').children.length===1)
    data.cats.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c.charAt(0).toUpperCase()+c.slice(1); $('f-cat').appendChild(o); });
  applyTotals(data.totals);
  cur=data.entry; curQ=data.question; render();
}
function applyTotals(t){
  $('s-rev').textContent=t.reviewed; $('s-rem').textContent=t.removed;
  $('s-left').textContent=t.remaining; $('s-tot').textContent=t.total;
  $('prog').style.width = (t.scopedTotal? ((t.scopedTotal-t.remaining)/t.scopedTotal*100):0)+'%';
}
function render(){
  const c=$('content');
  if (!cur||!curQ){ c.innerHTML='<div class="done">✓ All done for this filter!<br><span style="font-size:.85rem">Switch categories above, or you\\'ve screened everything.</span></div>'; return; }
  let inner='';
  if (cur.type==='mc'){
    const opts=curQ.options||{};
    inner='<div class="opts">'+Object.keys(opts).sort().map(L=>'<div class="opt '+(L===curQ.answer?'correct':'')+'"><span class="L">'+L+'</span><span>'+esc(opts[L])+'</span></div>').join('')+'</div>';
  } else {
    inner='<div class="answer">'+esc(curQ.Answer||curQ.answer||'')+'</div>';
  }
  c.innerHTML='<div class="card">'+
    '<div class="meta"><span class="badge '+cur.type+'">'+(cur.type==='mc'?'Multiple Choice':'Free Response')+'</span><span>'+esc(cur.catLabel)+'</span></div>'+
    '<div class="qtext">'+esc(curQ.Question||curQ.question||'')+'</div>'+inner+
    '<div class="actions">'+
      '<button class="btn remove" onclick="decide(\\'remove\\')">✗ Remove</button>'+
      '<button class="btn keep" onclick="decide(\\'keep\\')">✓ Keep</button>'+
      '<button class="btn undo" onclick="undo()" '+(lastAction?'':'disabled style="opacity:.4"')+'>↶ Undo</button>'+
    '</div></div>'+
    '<div class="hint">→ / K = keep · ← / X = remove · U = undo</div>';
}
async function decide(decision){
  if (!cur) return;
  const entry=cur;
  lastAction={ entry, question:curQ, wasRemoved:decision==='remove' };
  fetch('/api/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ key:entry.key, fileKey:entry.fileKey, decision })});
  toast(decision==='remove'?'Removed ✗':'Kept ✓');
  load();
}
async function undo(){
  if (!lastAction) return;
  await fetch('/api/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ key:lastAction.entry.key, fileKey:lastAction.entry.fileKey, question:lastAction.question, wasRemoved:lastAction.wasRemoved })});
  toast('Undone ↶'); lastAction=null; load();
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
document.addEventListener('keydown',e=>{
  if (e.target.tagName==='SELECT') return;
  if (e.key==='ArrowRight'||e.key==='k'||e.key==='K'){ e.preventDefault(); decide('keep'); }
  else if (e.key==='ArrowLeft'||e.key==='x'||e.key==='X'){ e.preventDefault(); decide('remove'); }
  else if (e.key==='u'||e.key==='U'){ e.preventDefault(); undo(); }
});
$('f-cat').addEventListener('change',()=>{ lastAction=null; load(); });
$('f-type').addEventListener('change',()=>{ lastAction=null; load(); });
load();
</script>
</body></html>`;
