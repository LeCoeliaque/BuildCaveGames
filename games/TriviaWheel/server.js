const http=require('http'),WebSocket=require('ws'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3000;
const CAT_DIR=path.join(__dirname,'categories');
const MC_DIR=path.join(__dirname,'categories_mc');

// ── FUZZY MATCH ───────────────────────────────────────────────
const NUM_WORDS={zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',ten:'10',eleven:'11',twelve:'12',thirteen:'13',fourteen:'14',fifteen:'15',sixteen:'16',seventeen:'17',eighteen:'18',nineteen:'19',twenty:'20',thirty:'30',forty:'40',fifty:'50',hundred:'100',thousand:'1000'};
function normalise(str){let s=String(str).toLowerCase().replace(/[,;\/\\]+/g,' ').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();return s.split(' ').map(w=>NUM_WORDS[w]||w).join(' ');}
function levenshtein(a,b){const m=a.length,n=b.length,dp=Array.from({length:m+1},(_,i)=>[i]);for(let j=0;j<=n;j++)dp[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);return dp[m][n];}
function judgeAnswer(p,c){
  const pn=normalise(p),cn=normalise(c);
  if(!pn)return{correct:false,matchType:'wrong'};
  if(pn===cn)return{correct:true,matchType:'exact'};
  if(cn.length>=4&&pn.length>=Math.ceil(cn.length*0.6)&&(pn.includes(cn)||cn.includes(pn)))return{correct:true,matchType:'contained'};
  const STOP=new Set(['and','the','of','or','a','an','in','on','at','to','by','for','is','was','are','were']);
  const cW=cn.split(' ').filter(w=>w.length>=3&&!STOP.has(w));
  const pW=pn.split(' ').filter(w=>w.length>=3&&!STOP.has(w));
  if(pW.length>=1&&cW.length>=1){
    const matched=pW.filter(pw=>cW.some(cw=>cw===pw||(pw.length>=5&&cw.length>=5&&(cw.includes(pw)||pw.includes(cw)))));
    if(matched.length/pW.length>=1.0&&matched.length/Math.max(cW.length,1)>=0.4)return{correct:true,matchType:'contained'};
  }
  const lr=pn.length/Math.max(cn.length,1);
  if(cn.length>=5&&pn.length>=5&&lr>=0.65&&lr<=1.55){
    const sim=1-levenshtein(pn,cn)/Math.max(pn.length,cn.length);
    if(sim>=(cn.length<=6?0.85:0.75))return{correct:true,matchType:'close'};
  }
  return{correct:false,matchType:'wrong'};
}

// ── CATEGORIES ────────────────────────────────────────────────
// Palette order must match alphabetical sort of your category filenames:
// 1=Math(red) 2=Geography(blue) 3=Philosophy(purple) 4=Engineering(orange)
// 5=Science(green) 6=History(yellow) 7=Technology(teal) 8=Legal(pink)
const PALETTE=['#e74c3c','#3498db','#8e44ad','#e67e22','#27ae60','#f1c40f','#1abc9c','#e91e63'];
function loadFR(){
  if(!fs.existsSync(CAT_DIR)){fs.mkdirSync(CAT_DIR,{recursive:true});return{ring:[],centre:null};}
  const files=fs.readdirSync(CAT_DIR).filter(f=>f.endsWith('.json')).sort();
  const ring=[];
  files.slice(0,8).forEach((file,i)=>{
    const id=path.basename(file,'.json').toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    const label=path.basename(file,'.json').replace(/^\d+[-_]?/,'').replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).trim();
    try{
      const data=JSON.parse(fs.readFileSync(path.join(CAT_DIR,file),'utf8'));
      const qs=data.map(e=>{const q=e.Question??e.question??e.q??null,a=e.Answer??e.answer??e.a??null;return q&&a?{q:String(q).trim(),a:String(a).trim()}:null;}).filter(Boolean);
      if(qs.length){ring.push({id,label,color:PALETTE[i%PALETTE.length],questions:qs,isMC:false});console.log(`  ✓ FR ${label} (${qs.length})`);}
    }catch(e){console.error(`  ✗ ${file}:`,e.message);}
  });
  let centre=null;
  const cf=files[8];
  if(cf){
    const id=path.basename(cf,'.json').toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    const label=path.basename(cf,'.json').replace(/^\d+[-_]?/,'').replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).trim();
    try{
      const data=JSON.parse(fs.readFileSync(path.join(CAT_DIR,cf),'utf8'));
      const qs=data.map(e=>{const q=e.Question??e.question??e.q??null,a=e.Answer??e.answer??e.a??null;return q&&a?{q:String(q).trim(),a:String(a).trim()}:null;}).filter(Boolean);
      if(qs.length){centre={id,label,color:'#f0c040',questions:qs,isMC:false};console.log(`  ✓ Centre ${label} (${qs.length})`);}
    }catch(e){console.error(`  ✗ ${cf}:`,e.message);}
  }
  // Fallback: if no dedicated centre file, reuse the first ring category's questions
  // but give it a DISTINCT id so it never collides with a real ring category.
  if(!centre&&ring.length)centre={...ring[0],id:'__centre__',label:'Centre',color:'#f0c040'};
  return{ring,centre};
}
function loadMC(){
  if(!fs.existsSync(MC_DIR)){fs.mkdirSync(MC_DIR,{recursive:true});return[];}
  const files=fs.readdirSync(MC_DIR).filter(f=>f.endsWith('.json')).sort();
  const cats=[];
  files.slice(0,8).forEach((file,i)=>{
    const id=path.basename(file,'.json').toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    const label=path.basename(file,'.json').replace(/^\d+[-_]?/,'').replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).trim();
    try{
      const data=JSON.parse(fs.readFileSync(path.join(MC_DIR,file),'utf8'));
      const qs=data.filter(e=>e.question&&e.answer&&e.options&&Object.keys(e.options).length>=2);
      if(qs.length){cats.push({id,label,color:PALETTE[i%PALETTE.length],questions:qs,isMC:true});console.log(`  ✓ MC ${label} (${qs.length})`);}
    }catch(e){console.error(`  ✗ ${file}:`,e.message);}
  });
  return cats;
}
let FR={ring:[],centre:null},MC=[];
function reloadAll(){console.log('\nLoading...');FR=loadFR();MC=loadMC();console.log(`  → ${FR.ring.length} FR, ${MC.length} MC\n`);}
reloadAll();
if(fs.existsSync(CAT_DIR))fs.watch(CAT_DIR,{persistent:false},reloadAll);
if(fs.existsSync(MC_DIR))fs.watch(MC_DIR,{persistent:false},reloadAll);

// ── BOARD ─────────────────────────────────────────────────────
const RING_SIZE=40,SPOKE_LEN=5;
const CORNER_POS=[0,10,20,30],MID_POS=[5,15,25,35],HQ_POS=[0,5,10,15,20,25,30,35];
function buildBoard(){
  const squares=[];
  // Ring categories are painted by counting only NON-HQ tiles, cycling cats[counter%8]
  // starting at cat index 1 (Geo) for the first non-HQ tile after corner 0.
  let nonHqCounter=0;
  for(let i=0;i<RING_SIZE;i++){
    const isCorner=CORNER_POS.includes(i),isMid=MID_POS.includes(i),isHQ=isCorner||isMid;
    let catIdx;
    if(isHQ){
      catIdx=HQ_POS.indexOf(i); // HQ tile uses its fixed category
    }else{
      nonHqCounter++;
      catIdx=nonHqCounter%8; // matches the painted board exactly
    }
    squares.push({id:i,type:'ring',catIdx,isHQ,isCorner,isMid,hqCatIdx:isHQ?HQ_POS.indexOf(i):-1});
  }
  // Spoke tile categories are read directly off the painted board (sampled per tile).
  // Each entry is a catIdx into the ring category order (Math,Geo,Phil,Eng,Sci,Hist,Tech,Legal).
  const SPOKE_CAT_IDX=[
    [2,3,4,5,7], // spoke 0: Phil, Eng, Sci, Hist, Legal
    [4,5,7,0,1], // spoke 1: Sci, Hist, Legal, Math, Geo
    [6,7,0,1,2], // spoke 2: Tech, Legal, Math, Geo, Phil
    [0,1,2,3,4], // spoke 3: Math, Geo, Phil, Eng, Sci
  ];
  for(let s=0;s<4;s++)for(let j=0;j<SPOKE_LEN;j++)
    squares.push({id:RING_SIZE+s*SPOKE_LEN+j,type:'spoke',catIdx:SPOKE_CAT_IDX[s]?.[j]??0,isHQ:false,spokeIdx:s,posInSpoke:j});
  const centreId=RING_SIZE+4*SPOKE_LEN;
  squares.push({id:centreId,type:'centre',catIdx:-1,isHQ:false});
  return{squares,centreId,RING:RING_SIZE,SPOKE_LEN,HQ_POS,CORNER_POS,MID_POS};
}
function moveRing(pos,steps,board,wedges){
  const catIds=FR.ring.map(c=>c.id);
  const hasAll=catIds.length>0&&catIds.every(id=>wedges?.[id]);
  let cur=pos%board.RING;
  for(let i=0;i<steps;i++){
    cur=(cur+1)%board.RING;
    const sq=board.squares[cur];
    if(sq?.isHQ){
      const cat=FR.ring[sq.hqCatIdx];
      // Stop at HQs you don't own (to earn the wedge)
      if(cat&&!wedges?.[cat.id])return{newPos:cur,stoppedAtHQ:true,hqCatIdx:sq.hqCatIdx};
      // If you have ALL wedges, stop at midpoints so you can choose to turn inward
      if(hasAll&&sq.isMid&&i<steps-1)return{newPos:cur,stoppedAtHQ:false,hqCatIdx:-1,atMidpoint:true};
    }
  }
  const finalSq=board.squares[cur];
  return{newPos:cur,stoppedAtHQ:false,hqCatIdx:-1,atMidpoint:hasAll&&finalSq?.isMid};
}
function getRingCat(catIdx){
  const ringCat=FR.ring[catIdx%Math.max(FR.ring.length,1)]||null;
  if(MC.length>0&&ringCat){
    // Prefer the MC category with the SAME id as the ring category (robust if orders differ).
    const mcMatch=MC.find(c=>c.id===ringCat.id);
    if(mcMatch)return mcMatch;
    return MC[catIdx%MC.length];
  }
  return ringCat;
}
function getHQCat(hqCatIdx){return FR.ring[hqCatIdx%Math.max(FR.ring.length,1)]||null;}

// ── HELPERS ───────────────────────────────────────────────────
const PLAYER_COLORS=['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#ff6b6b','#48dbfb'];
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function pickQ(cat,used){
  if(!cat)return null;
  const key=q=>q.question||q.q||'';
  const pool=cat.questions.filter(q=>!used.has(key(q)));
  if(!pool.length){used.clear();return cat.questions[Math.floor(Math.random()*cat.questions.length)];}
  const q=pool[Math.floor(Math.random()*pool.length)];
  used.add(key(q));return q;
}
function roll(){return Math.floor(Math.random()*6)+1;}

// Format the full answer for display: MC shows "A: option text", FR shows the answer
function fullAnswerText(q,isMC){
  if(!q)return '';
  if(isMC){
    const letter=q.answer;
    const opt=q.options?.[letter];
    return opt?`${letter}: ${opt}`:letter;
  }
  return q.a||q.answer||'';
}
// Format a player's MC choice as "A: text"
function mcChoiceText(q,letter){
  if(!q||!letter)return letter||'';
  const opt=q.options?.[letter];
  return opt?`${letter}: ${opt}`:letter;
}

// ── DEV: flag/remove bad questions ────────────────────────────
const FLAGGED_FILE=path.join(__dirname,'flagged_questions.json');
function flagQuestion(q){
  let flagged=[];
  try{if(fs.existsSync(FLAGGED_FILE))flagged=JSON.parse(fs.readFileSync(FLAGGED_FILE,'utf8'));}catch(e){}
  flagged.push({...q,flaggedAt:new Date().toISOString()});
  try{fs.writeFileSync(FLAGGED_FILE,JSON.stringify(flagged,null,2));console.log('[DEV] Flagged:',(q.question||'').slice(0,50));}catch(e){console.error('Flag write failed:',e.message);}
}
function removeQuestionFromPool(catId,isMC,questionText){
  const pool=isMC?MC:FR.ring.concat(FR.centre?[FR.centre]:[]);
  const cat=pool.find(c=>c.id===catId);
  if(!cat)return;
  const before=cat.questions.length;
  cat.questions=cat.questions.filter(q=>(q.question||q.q)!==questionText);
  console.log(`[DEV] Removed from ${catId}: ${before}→${cat.questions.length}`);
}

// ── ROOM ──────────────────────────────────────────────────────
let rooms={};
function mkRoom(code){return{
  code,players:{},hostId:null,state:'lobby',
  board:null,usedQ:new Set(),round:0,
  turnOrder:[],activePlayerId:null,
  diceRoll:null,targetSquareId:null,
  currentCatId:null,currentQ:null,isCurrentMC:false,
  activeAnswer:null,mcAnswer:null,
  stealAttempts:[],stealBuzzerId:null,stealTriedIds:new Set(),
  challengerId:null,challengeClaimedWinnerId:null,challengeVotes:{},_voterIds:[],_challengeResolved:false,
  reveal:null,timer:null,timeLeft:0,
  _landedOnMid:false,_midIdx:-1,
};}

function pSnap(room,p){
  const catIds=FR.ring.map(c=>c.id);
  const showPending=['question','steal','centre_question'].includes(room.state)&&p._pendingPos!=null;
  return{id:p.id,name:p.name,color:PLAYER_COLORS[p.colorIndex],
    pos:showPending?p._pendingPos:(p.pos??0),
    wedges:p.wedges||{},wedgeCount:catIds.filter(id=>p.wedges?.[id]).length,
    isHost:p.id===room.hostId,isActive:p.id===room.activePlayerId,
    disconnected:!!p._disconnected};
}
function snap(room){
  const mcQ=room.currentQ&&room.isCurrentMC?{text:room.currentQ.question,options:room.currentQ.options,catId:room.currentCatId,isMC:true}:null;
  const frQ=room.currentQ&&!room.isCurrentMC?{text:room.currentQ.q||room.currentQ.question,catId:room.currentCatId,isMC:false}:null;
  // Active player's answer is always public
  // Steal attempts: hide answer text until steal resolves (show name + "answered" only)
  const stealAttemptsPublic=(room.stealAttempts||[]).map(a=>({
    playerId:a.playerId,name:a.name,
    // During steal phase hide the answer; after steal resolves it's in reveal
    answered:true,
  }));
  return{type:'state',state:room.state,round:room.round,
    categories:{ring:FR.ring.map(c=>({id:c.id,label:c.label,color:c.color})),
      mc:MC.map(c=>({id:c.id,label:c.label,color:c.color})),
      centre:FR.centre?{id:FR.centre.id,label:FR.centre.label,color:FR.centre.color}:null},
    board:room.board,players:Object.values(room.players).map(p=>pSnap(room,p)),
    activePlayerId:room.activePlayerId,diceRoll:room.diceRoll,targetSquareId:room.targetSquareId,
    movePath:room.movePath||null,
    currentCatId:room.currentCatId,currentQ:mcQ||frQ,
    activeAnswer:room.activeAnswer, // always public
    mcAnswer:room.mcAnswer,         // always public
    stealBuzzerId:room.stealBuzzerId,
    stealTriedIds:[...(room.stealTriedIds||new Set())],
    stealAttempts:room.state==='steal'?stealAttemptsPublic:(room.stealAttempts||[]),
    challengerId:room.challengerId,challengeClaimedWinnerId:room.challengeClaimedWinnerId,
    challengeVotes:room.challengeVotes,challengeVoterIds:room._voterIds||[],
    reveal:room.reveal,timeLeft:room.timeLeft};
}
function bcast(room,msg){Object.values(room.players).forEach(p=>{try{if(p.ws.readyState===WebSocket.OPEN)p.ws.send(JSON.stringify(msg));}catch(e){}});}
function sendTo(ws,msg){try{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));}catch(e){}}
function clrTimer(room){if(room.timer){clearInterval(room.timer);room.timer=null;}}
function clrAdv(room){if(room._adv){clearTimeout(room._adv);room._adv=null;}}
function advAfter(room,ms,fn){clrAdv(room);room._adv=setTimeout(()=>{room._adv=null;fn();},ms);}
function countdown(room,secs,onDone){
  clrTimer(room);room.timeLeft=secs;
  bcast(room,{type:'tick',timeLeft:secs});
  room.timer=setInterval(()=>{
    room.timeLeft--;
    bcast(room,{type:'tick',timeLeft:room.timeLeft});
    if(room.timeLeft<=0){clrTimer(room);onDone();}
  },1000);
}

// ── GAME FLOW ─────────────────────────────────────────────────
function startTurn(room){
  room.round++;
  room.activeAnswer=null;room.mcAnswer=null;
  room.stealAttempts=[];room.stealBuzzerId=null;room.stealTriedIds=new Set();
  room.reveal=null;room.currentQ=null;room.currentCatId=null;room.isCurrentMC=false;
  room.targetSquareId=null;room.diceRoll=null;room._landedOnMid=false;room._midIdx=-1;
  clrChallenge(room);
  Object.values(room.players).forEach(p=>{p._pendingPos=null;});
  if(!room.turnOrder.length)room.turnOrder=shuffle(Object.keys(room.players));
  room.turnOrder=room.turnOrder.filter(id=>room.players[id]);
  if(!room.turnOrder.length)return; // no players left

  // Skip players who are currently disconnected (don't stall the game on their timers).
  // Try up to one full lap; if everyone is disconnected, fall back to the next in order.
  let activeId=null;
  for(let k=0;k<room.turnOrder.length;k++){
    const cand=room.turnOrder[(room.round-1+k)%room.turnOrder.length];
    if(room.players[cand]&&!room.players[cand]._disconnected){activeId=cand;room.round+=k;break;}
  }
  room.activePlayerId=activeId||room.turnOrder[(room.round-1)%room.turnOrder.length];
  room.state='roll';bcast(room,snap(room));
  countdown(room,30,()=>doMove(room));
}

function doMove(room){
  clrTimer(room);clrAdv(room);
  // Always reset answer/reveal/challenge state at move start (covers roll-again path that skips startTurn)
  room.mcAnswer=null;room.activeAnswer=null;
  room.reveal=null;clrChallenge(room);
  room.stealAttempts=[];room.stealBuzzerId=null;room.stealTriedIds=new Set([room.activePlayerId]);
  const player=room.players[room.activePlayerId];
  const board=room.board;
  const die=roll();room.diceRoll=die;
  const pos=player.pos??0;
  const sq=board.squares.find(s=>s.id===pos);
  let newPos,stoppedAtHQ=false,hqCatIdx=-1;

  if(pos===board.centreId){newPos=pos;room.movePath=[pos];}
  else if(sq?.type==='spoke'){
    const off=pos-board.RING,sIdx=Math.floor(off/board.SPOKE_LEN),pip=off%board.SPOKE_LEN;
    const catIds=FR.ring.map(c=>c.id);
    const hasAll=catIds.every(id=>player.wedges?.[id]);
    const newPip=pip+die;
    const path=[];
    // Step inward one tile at a time, without duplicating clamped tiles
    for(let p=pip+1;p<board.SPOKE_LEN&&p<=newPip;p++){
      path.push(board.RING+sIdx*board.SPOKE_LEN+p);
    }
    if(newPip>=board.SPOKE_LEN){
      // Reached/overshot the inner end of the spoke
      if(hasAll){newPos=board.centreId;path.push(board.centreId);}
      else{
        // Shouldn't normally happen (spoke entry requires all wedges), but handle safely:
        // stop at the innermost spoke tile rather than bouncing back to the ring.
        newPos=board.RING+sIdx*board.SPOKE_LEN+(board.SPOKE_LEN-1);
        if(path[path.length-1]!==newPos)path.push(newPos);
      }
    }else{
      newPos=board.RING+sIdx*board.SPOKE_LEN+newPip;
    }
    room.movePath=path.length?path:[newPos];
  }else{
    // Build step-by-step ring path
    const r=moveRing(pos,die,board,player.wedges);
    newPos=r.newPos;stoppedAtHQ=r.stoppedAtHQ;hqCatIdx=r.hqCatIdx;
    const path2=[];let cur2=pos%board.RING;
    for(let i=0;i<die;i++){
      cur2=(cur2+1)%board.RING;path2.push(cur2);
      if(cur2===newPos)break;
    }
    room.movePath=path2;
    // moveRing flags when a fully-wedged player reaches a midpoint
    if(r.atMidpoint){
      room._canEnterSpoke=true;
      room._spokeIdx=MID_POS.indexOf(newPos);
    }else{room._canEnterSpoke=false;room._spokeIdx=-1;}
  }

  // Commit position immediately — player stays where they land regardless of answer outcome
  player.pos=newPos;player._pendingPos=null;
  room.targetSquareId=newPos;
  const landedSq=board.squares.find(s=>s.id===newPos);

  if(landedSq?.type==='centre'){
    const catIds=FR.ring.map(c=>c.id);
    if(!catIds.every(id=>player.wedges?.[id])){
      const missing=catIds.filter(id=>!player.wedges?.[id]).length;
      // Send them back to the midpoint they came from
      const fromSq=board.squares.find(s=>s.id===pos);
      const spokeSq=fromSq?.type==='spoke'?fromSq:null;
      player.pos=spokeSq?MID_POS[spokeSq.spokeIdx]:pos;
      room.reveal={message:`Need ${missing} more wedge${missing!==1?'s':''} to enter the centre!`,noop:true};
      room.state='reveal';bcast(room,snap(room));
      advAfter(room,4000,()=>{if(rooms[room.code]?.state==='reveal')startTurn(room);});
      return;
    }
    startCentreQ(room);return;
  }

  // If a fully-wedged player landed on a midpoint, offer the spoke turn immediately (no question)
  if(room._canEnterSpoke&&landedSq?.isMid){
    room.reveal={
      offerRouteChoice:true,spokeEntry:true,
      activePlayerId:room.activePlayerId,activePlayerName:player?.name,
      squareId:newPos,catId:null,
    };
    room._midIdx=room._spokeIdx;
    room.state='reveal';bcast(room,snap(room));
    room.movePath=null;
    return;
  }

  let cat,isMC=false;
  if(stoppedAtHQ){cat=getHQCat(hqCatIdx);isMC=false;}
  else if(landedSq?.type==='spoke'){cat=getRingCat(landedSq.catIdx);isMC=cat?.isMC||false;}
  else{cat=getRingCat(landedSq?.catIdx||0);isMC=cat?.isMC||false;}

  room.currentCatId=cat?.id;room.currentQ=pickQ(cat,room.usedQ);room.isCurrentMC=isMC;
  room._landedOnMid=stoppedAtHQ&&landedSq?.isMid;
  room._midIdx=room._landedOnMid?MID_POS.indexOf(newPos):-1;

  if(!room.currentQ){console.error('No question for cat:',cat?.id);bcast(room,{type:'error',message:'No questions available.'});return;}

  console.log(`[QUESTION] room=${room.code} isMC=${isMC} cat=${cat?.id} sq=${newPos} isHQ=${stoppedAtHQ}`);

  // Dice has been spinning ~1.1s on clients. Now broadcast the result so it settles
  // and the token animates along movePath.
  room.state='roll';
  room.diceRoll=die;
  bcast(room,snap(room));

  // Wait for dice settle (0.7s) + token hop animation, then switch to question
  const hopTime=900+(room.movePath?.length||1)*230;
  setTimeout(()=>{
    if(!rooms[room.code])return;
    room.state='question';
    bcast(room,snap(room));
    room.movePath=null;
    countdown(room,45,()=>{
      if(room.state!=='question'){return;}
      clrTimer(room);
      if(room.isCurrentMC&&room.mcAnswer!=null){resolveQ(room,null);}
      else if(!room.isCurrentMC&&room.activeAnswer?.answer!=null){
        if(room.activeAnswer.correct){resolveQ(room,null);}else{openSteal(room);}
      }else{
        if(!room.isCurrentMC)room.activeAnswer={answer:null,timeMs:45000,correct:false,matchType:'wrong'};
        openSteal(room);
      }
    });
  },hopTime);
}

function startCentreQ(room){
  clrTimer(room);
  const player=room.players[room.activePlayerId];
  player.pos=room.targetSquareId;player._pendingPos=null;
  room.currentQ=pickQ(FR.centre,room.usedQ);room.currentCatId=FR.centre?.id;room.isCurrentMC=false;
  room.state='centre_question';bcast(room,snap(room));
  countdown(room,45,()=>{
    if(room.state!=='centre_question')return;
    clrTimer(room);
    if(room.activeAnswer?.answer!=null){resolveCentreQ(room);}
    else{room.activeAnswer={answer:null,timeMs:45000,correct:false,matchType:'wrong'};resolveCentreQ(room);}
  });
}

function resolveCentreQ(room){
  clrTimer(room);
  const correct=room.activeAnswer?.correct||false;
  if(correct){
    room.state='gameover';
    room.reveal={correctAnswer:room.currentQ?.a,activeAnswer:room.activeAnswer,gameOver:true,
      gameWinnerId:room.activePlayerId,gameWinnerName:room.players[room.activePlayerId]?.name};
  }else{
    room.players[room.activePlayerId].pos=MID_POS[0];
    room.reveal={correctAnswer:room.currentQ?.a,activeAnswer:room.activeAnswer,centreWrongAnswer:true};
    room.state='reveal';bcast(room,snap(room));
    advAfter(room,5000,()=>{if(rooms[room.code]?.state==='reveal')startTurn(room);});return;
  }
  bcast(room,snap(room));
}

function openSteal(room){
  if(room.state==='steal'){console.log('[STEAL] already open, skip');return;}
  clrTimer(room);
  room.stealAttempts=[];room.stealBuzzerId=null;
  room.stealTriedIds=new Set([room.activePlayerId]);
  room.state='steal';bcast(room,snap(room));
  console.log(`[STEAL] opened, room=${room.code}`);
  countdown(room,15,()=>{
    if(room.state!=='steal')return;
    console.log('[STEAL] timed out with no buzz');
    resolveSteal(room);
  });
}

function buzzIn(room,pid){
  clrTimer(room);
  room.stealBuzzerId=pid;
  room.stealTriedIds.add(pid);
  bcast(room,snap(room));
  console.log(`[BUZZ] ${pid} buzzed in, room=${room.code}`);
  countdown(room,10,()=>{
    if(room.state!=='steal')return;
    console.log('[BUZZ] timed out, no answer from',pid);
    room.stealAttempts.push({playerId:pid,name:room.players[pid]?.name,answer:null,correct:false,matchType:'wrong'});
    room.stealBuzzerId=null;
    nextBuzzWindow(room);
  });
}

function submitSteal(room,pid,answer,correct,matchType){
  clrTimer(room);
  room.stealAttempts.push({playerId:pid,name:room.players[pid]?.name,answer,correct,matchType});
  room.stealBuzzerId=null;
  console.log(`[STEAL ANSWER] ${pid} answer="${answer}" correct=${correct}`);
  if(correct){resolveSteal(room);}else{nextBuzzWindow(room);}
}

function nextBuzzWindow(room){
  const remaining=Object.keys(room.players).filter(id=>!room.stealTriedIds.has(id));
  if(remaining.length>0){
    bcast(room,snap(room));
    countdown(room,15,()=>{if(room.state==='steal')resolveSteal(room);});
  }else{resolveSteal(room);}
}

function resolveSteal(room){
  clrTimer(room);
  const winner=room.stealAttempts.find(a=>a.correct);
  const sq=room.board.squares.find(s=>s.id===room.targetSquareId);
  const catId=room.currentCatId;
  const isHQ=sq?.isHQ||false;
  const cat=FR.ring.find(c=>c.id===catId)||MC.find(c=>c.id===catId)||null;
  const player=room.players[room.activePlayerId];
  const correctAnswer=fullAnswerText(room.currentQ,room.isCurrentMC);

  // Active player already committed to their new position in doMove
  // Winner stealer moves to the target square
  if(winner){
    const stealer=room.players[winner.playerId];
    if(stealer){
      stealer.pos=room.targetSquareId;stealer._pendingPos=null;
      if(isHQ&&catId&&!stealer.wedges?.[catId]){if(!stealer.wedges)stealer.wedges={};stealer.wedges[catId]=true;}
    }
  }

  const catIds=FR.ring.map(c=>c.id);
  room.reveal={
    catId,catLabel:cat?.label||catId,correctAnswer,
    isMC:room.isCurrentMC,squareId:room.targetSquareId,isHQ,isMid:sq?.isMid,isCorner:sq?.isCorner,
    diceRoll:room.diceRoll,
    activePlayerId:room.activePlayerId,activePlayerName:player?.name,
    activeAnswer:room.isCurrentMC?{answer:mcChoiceText(room.currentQ,room.mcAnswer),correct:false}:room.activeAnswer,
    activeCorrect:false,
    stealAttempts:room.stealAttempts,stealWinnerId:winner?.playerId||null,stealWinnerName:winner?.name||null,
    wedgeEarned:!!winner&&isHQ,rollAgain:false,
    stealWheelComplete:winner?catIds.every(id=>room.players[winner.playerId]?.wedges?.[id]):false,
  };
  room.state='reveal';bcast(room,snap(room));
  console.log(`[RESOLVE STEAL] winner=${winner?.playerId||'none'} room=${room.code}`);
  advAfter(room,5000,()=>{if(rooms[room.code]?.state==='reveal')startTurn(room);});
}

function resolveQ(room,_unused){
  clrTimer(room);
  const sq=room.board.squares.find(s=>s.id===room.targetSquareId);
  const activeCorrect=room.isCurrentMC?(room.mcAnswer===room.currentQ?.answer):room.activeAnswer?.correct||false;
  const player=room.players[room.activePlayerId];
  const catId=room.currentCatId;
  const cat=FR.ring.find(c=>c.id===catId)||MC.find(c=>c.id===catId)||null;
  const isHQ=sq?.isHQ||false;
  const correctAnswer=fullAnswerText(room.currentQ,room.isCurrentMC);

  console.log(`[RESOLVEQ] room=${room.code} isCurrentMC=${room.isCurrentMC} mcAnswer=${room.mcAnswer} correctAnswer=${correctAnswer} activeCorrect=${activeCorrect}`);

  if(!activeCorrect){
    // Wrong — open steal
    room.activeAnswer=room.activeAnswer||{answer:room.mcAnswer,timeMs:0,correct:false,matchType:'wrong'};
    openSteal(room);
    return;
  }

  // Correct - position already committed in doMove, just handle wedge
  let wedgeEarned=false,offerRouteChoice=false;
  if(isHQ&&catId&&!player.wedges?.[catId]){
    if(!player.wedges)player.wedges={};player.wedges[catId]=true;wedgeEarned=true;
  }

  const catIds=FR.ring.map(c=>c.id);
  const wheelComplete=catIds.every(id=>player.wedges?.[id]);

  // Offer the spoke route ONLY when standing on a midpoint HQ AND the player has all 8 wedges
  // (you can't enter the centre prematurely, so there's no reason to go inward before that)
  if(room._landedOnMid&&wheelComplete){offerRouteChoice=true;}

  room.reveal={
    catId,catLabel:cat?.label||catId,correctAnswer,
    isMC:room.isCurrentMC,squareId:room.targetSquareId,isHQ,isMid:sq?.isMid,isCorner:sq?.isCorner,
    diceRoll:room.diceRoll,wedgeEarned,rollAgain:true,offerRouteChoice,wheelComplete,
    activePlayerId:room.activePlayerId,activePlayerName:player?.name,
    activeAnswer:room.isCurrentMC?{answer:mcChoiceText(room.currentQ,room.mcAnswer),correct:true,matchType:'exact'}:room.activeAnswer,
    activeCorrect:true,stealAttempts:[],stealWinnerId:null,
  };
  room.state='reveal';bcast(room,snap(room));

  if(offerRouteChoice)return;
  const delay=wheelComplete?3000:2000;
  advAfter(room,delay,()=>{
    if(rooms[room.code]?.state==='reveal'){
      room.state='roll';room.diceRoll=null;clrTimer(room);
      bcast(room,snap(room));countdown(room,30,()=>doMove(room));
    }
  });
}

// ── CHALLENGE ─────────────────────────────────────────────────
function clrChallenge(room){
  room.challengerId=null;room.challengeClaimedWinnerId=null;
  room.challengeVotes={};room._voterIds=[];room._challengeResolved=false;
}
function proceedAfterChallenge(room){
  clrTimer(room);clrAdv(room);clrChallenge(room);
  const rev=room.reveal;
  if(!rev)return startTurn(room);
  // Original ruling stands — return to the reveal display, then auto-advance
  room.state='reveal';bcast(room,snap(room));
  if(rev.offerRouteChoice)return; // active player must still choose route
  advAfter(room,3000,()=>{
    if(rooms[room.code]?.state!=='reveal')return;
    if(rev.rollAgain){
      room.state='roll';room.diceRoll=null;clrTimer(room);
      bcast(room,snap(room));countdown(room,30,()=>doMove(room));
    }else{
      startTurn(room);
    }
  });
}

function applyOverride(room,winnerId){
  clrTimer(room);clrAdv(room);
  const winner=room.players[winnerId];
  if(!winner){clrChallenge(room);return proceedAfterChallenge(room);}

  const sq=room.board?.squares?.find(s=>s.id===room.targetSquareId);
  const catId=room.currentCatId;
  const isHQ=sq?.isHQ||false;
  const isActive=winnerId===room.activePlayerId;
  const catIds=FR.ring.map(c=>c.id);

  // Reverse any wedge awarded by the ORIGINAL ruling to a different player
  const rev=room.reveal;
  const prevWinnerId=rev.activeCorrect?rev.activePlayerId:(rev.stealWinnerId||null);
  if(prevWinnerId&&prevWinnerId!==winnerId&&rev.wedgeEarned&&isHQ&&catId){
    const prev=room.players[prevWinnerId];
    if(prev&&prev.wedges){delete prev.wedges[catId];}
  }

  // Award to the new winner
  winner.pos=room.targetSquareId;winner._pendingPos=null;
  let wedgeEarned=false;
  if(isHQ&&catId&&!winner.wedges?.[catId]){
    if(!winner.wedges)winner.wedges={};
    winner.wedges[catId]=true;wedgeEarned=true;
  }

  // Rebuild reveal to reflect the override outcome
  rev.overridden=true;
  rev.activeCorrect=isActive;
  rev.wedgeEarned=wedgeEarned||(isHQ&&!!winner.wedges?.[catId]);
  rev.stealWinnerId=isActive?null:winnerId;
  rev.stealWinnerName=isActive?null:winner.name;
  rev.overrideWinnerId=winnerId;
  rev.overrideWinnerName=winner.name;
  rev.offerRouteChoice=false;
  rev.rollAgain=isActive;
  if(catIds.every(id=>winner.wedges?.[id]))rev.wheelComplete=true;

  clrChallenge(room);
  room.state='reveal';bcast(room,snap(room));

  advAfter(room,3500,()=>{
    if(rooms[room.code]?.state!=='reveal')return;
    if(rev.rollAgain){
      room.state='roll';room.diceRoll=null;clrTimer(room);
      bcast(room,snap(room));countdown(room,30,()=>doMove(room));
    }else{
      startTurn(room);
    }
  });
}

// ── HTTP + WS ─────────────────────────────────────────────────
const server=http.createServer((req,res)=>{
  if(req.url==='/'||req.url==='/index.html'){
    fs.readFile(path.join(__dirname,'index.html'),(err,data)=>{if(err){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html'});res.end(data);});
  }else if(req.url.startsWith('/assets/')){
    const fp=path.join(__dirname,req.url.slice(1));
    if(!fp.startsWith(path.join(__dirname,'assets'))){res.writeHead(403);res.end();return;}
    fs.readFile(fp,(err,data)=>{
      if(err){res.writeHead(404);res.end();return;}
      const ext=path.extname(fp).toLowerCase();
      const mime={'.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.gif':'image/gif','.js':'text/javascript','.css':'text/css','.json':'application/json','.mp3':'audio/mpeg','.wav':'audio/wav'}[ext]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime});res.end(data);
    });
  }else{res.writeHead(404);res.end();}
});

const wss=new WebSocket.Server({server});
wss.on('connection',ws=>{
  let pid=null,rcode=null;
  ws.on('message',raw=>{
    let msg;try{msg=JSON.parse(raw);}catch{return;}

    if(msg.type==='join'){
      rcode=(msg.roomCode||'').toUpperCase().trim();
      pid=msg.playerId||Math.random().toString(36).slice(2,9);
      const name=(msg.name||'Player').trim().slice(0,16);
      if(!rooms[rcode])rooms[rcode]=mkRoom(rcode);
      const room=rooms[rcode];
      const isExisting=!!room.players[pid];
      if(room.state!=='lobby'&&!isExisting){
        // Game in progress and this is a brand-new player — reject
        sendTo(ws,{type:'error',message:'Game already in progress.'});return;
      }
      if(isExisting){
        // Reconnecting player — just swap their socket back in
        room.players[pid].ws=ws;
        room.players[pid]._disconnected=false;
        if(room.players[pid]._dcTimer){clearTimeout(room.players[pid]._dcTimer);room.players[pid]._dcTimer=null;}
        console.log(`[RECONNECT] ${name} (${pid}) rejoined ${rcode}`);
      }else{
        const ci=Object.keys(room.players).length%PLAYER_COLORS.length;
        room.players[pid]={id:pid,name,ws,colorIndex:ci,pos:0,wedges:{},_pendingPos:null};
      }
      if(!room.hostId)room.hostId=pid;
      sendTo(ws,{type:'joined',playerId:pid,roomCode:rcode,reconnected:isExisting});
      bcast(room,snap(room));return;
    }

    const room=rooms[rcode];if(!room||!pid)return;
    const p=room.players[pid];

    if(msg.type==='start'){
      if(pid!==room.hostId)return;
      if(Object.keys(room.players).length<2){sendTo(ws,{type:'error',message:'Need 2+ players.'});return;}
      room.board=buildBoard();
      room.turnOrder=shuffle(Object.keys(room.players));
      Object.values(room.players).forEach(p=>{p.pos=0;p.wedges={};p._pendingPos=null;});
      startTurn(room);
    }

    else if(msg.type==='roll'){
      if(room.state!=='roll'||pid!==room.activePlayerId)return;
      clrTimer(room);
      // Tell all clients the roll has started — they show spinning dice
      bcast(room,{type:'rolling',activePlayerId:pid});
      // Wait so the dice can visibly spin, THEN compute and reveal the result
      setTimeout(()=>{if(rooms[room.code])doMove(room);},1100);
    }

    else if(msg.type==='mcAnswer'){
      if(room.state!=='question')return;
      if(pid!==room.activePlayerId)return;
      if(room.mcAnswer!=null)return;
      if(!room.isCurrentMC){console.warn('[mcAnswer] not an MC question, ignoring');return;}
      const letter=(msg.letter||'').toUpperCase();
      if(!['A','B','C','D','E'].includes(letter))return;
      console.log(`[MC ANSWER] room=${room.code} pid=${pid} letter=${letter} correct=${room.currentQ?.answer}`);
      room.mcAnswer=letter;
      clrTimer(room);
      sendTo(ws,{type:'answerAck',answer:letter});
      resolveQ(room,null);
    }

    else if(msg.type==='answer'){
      const validStates=['question','centre_question','steal'];
      if(!validStates.includes(room.state))return;
      if(pid!==room.activePlayerId)return;
      if(room.activeAnswer?.answer!=null)return;
      const answer=(msg.answer||'').trim();if(!answer)return;
      if(!room.currentQ){
        room.activeAnswer={answer,timeMs:msg.timeMs||30000,correct:false,matchType:'wrong'};
        clrTimer(room);openSteal(room);return;
      }
      const correctAns=room.currentQ.a||room.currentQ.answer||'';
      const result=judgeAnswer(answer,correctAns);
      room.activeAnswer={answer,timeMs:msg.timeMs||30000,...result};
      clrTimer(room);
      sendTo(ws,{type:'answerAck',answer,correct:result.correct,matchType:result.matchType});
      // Only a genuine centre question (by state) should resolve as a win.
      // Do NOT compare category IDs — the centre may fall back to ring[0]'s id,
      // which would wrongly treat that ring category as the centre.
      const isCentre=room.state==='centre_question';
      if(isCentre){resolveCentreQ(room);}
      else if(result.correct){resolveQ(room,null);}
      else if(room.state==='steal'){resolveSteal(room);}
      else{openSteal(room);}
    }

    else if(msg.type==='stealBuzz'){
      if(room.state!=='steal')return;
      if(pid===room.activePlayerId)return;
      if(room.stealBuzzerId)return;
      if(room.stealTriedIds.has(pid))return;
      buzzIn(room,pid);
    }

    else if(msg.type==='stealAnswer'){
      if(room.state!=='steal'||pid!==room.stealBuzzerId)return;
      if(room.isCurrentMC){
        const letter=(msg.letter||'').toUpperCase();
        if(!['A','B','C','D','E'].includes(letter))return;
        const correct=letter===room.currentQ?.answer;
        submitSteal(room,pid,mcChoiceText(room.currentQ,letter),correct,correct?'exact':'wrong');
      }else{
        const answer=(msg.answer||'').trim();if(!answer)return;
        const result=judgeAnswer(answer,room.currentQ?.a||room.currentQ?.answer||'');
        submitSteal(room,pid,answer,result.correct,result.matchType);
      }
    }

    else if(msg.type==='initChallenge'){
      if(room.state!=='reveal')return;          // only from a live reveal
      if(!room.reveal)return;
      if(room.reveal.overridden)return;          // already resolved by a challenge
      if(room.reveal.gameOver)return;            // can't challenge a win
      if(room.reveal.offerRouteChoice)return;    // mid route-choice
      if(room.challengerId)return;               // challenge already running
      clrAdv(room);clrTimer(room);
      room.challengeClaimedWinnerId=null;room.challengeVotes={};room._voterIds=[];
      room.challengerId=pid;
      room._challengeResolved=false;
      room.state='challenge';bcast(room,snap(room));
      countdown(room,15,()=>{
        // Challenger never picked anyone — cancel, restore reveal
        if(room.state==='challenge'){clrChallenge(room);proceedAfterChallenge(room);}
      });
    }

    else if(msg.type==='challengeClaim'){
      if(room.state!=='challenge')return;
      if(room.challengerId!==pid)return;
      const claimedId=msg.winnerId;
      if(!room.players[claimedId])return;
      clrTimer(room);
      room.challengeClaimedWinnerId=claimedId;
      // Determine voters: everyone except the challenger.
      // For even player counts, also exclude the contested person to avoid ties,
      // but never end up with zero voters.
      const allIds=Object.keys(room.players);
      const contested=claimedId===room.activePlayerId
        ?(room.stealBuzzerId||null)
        :room.activePlayerId;
      let voterIds=allIds.filter(id=>id!==pid);
      if(allIds.length%2===0){
        const trimmed=voterIds.filter(id=>id!==contested);
        if(trimmed.length>0)voterIds=trimmed;
      }
      room._voterIds=voterIds;
      room.challengeVotes={};
      room._challengeResolved=false;
      room.state='challenge_vote';bcast(room,snap(room));
      countdown(room,20,()=>resolveChallenge(room));
    }

    else if(msg.type==='challengeVote'){
      if(room.state!=='challenge_vote')return;
      if(!room._voterIds.includes(pid))return;
      if(room.challengeVotes[pid]!=null)return;
      if(typeof msg.agree!=='boolean')return;
      room.challengeVotes[pid]=msg.agree;
      bcast(room,snap(room));
      // If everyone has voted, resolve now (resolveChallenge guards against double-run)
      if(room._voterIds.every(id=>room.challengeVotes[id]!=null))resolveChallenge(room);
    }

    else if(msg.type==='chooseRoute'){
      if(room.state!=='reveal'||pid!==room.activePlayerId)return;
      if(!room.reveal?.offerRouteChoice)return;
      const sIdx=room._midIdx;
      if(msg.route==='spoke'&&sIdx>=0){
        // Place at the OUTERMOST spoke tile (posInSpoke 0); subsequent rolls move inward
        room.players[pid].pos=room.board.RING+sIdx*room.board.SPOKE_LEN;
      }
      // 'ring' route: stay where they are (already on the midpoint)
      room.reveal.offerRouteChoice=false;room.reveal.routeChosen=msg.route;
      room._canEnterSpoke=false;room._spokeIdx=-1;
      room.movePath=null; // no animation for the route transition — snap cleanly
      room.targetSquareId=null;
      clrTimer(room);clrAdv(room);
      room.state='roll';room.diceRoll=null;
      bcast(room,snap(room));countdown(room,30,()=>doMove(room));
    }

    else if(msg.type==='hostOverride'){
      if(pid!==room.hostId||room.state!=='reveal')return;
      if(!room.reveal||room.reveal.overridden)return;
      applyOverride(room,msg.winnerId||room.activePlayerId);
    }

    else if(msg.type==='devCommand'){
      // Dev mode — intended for local testing
      const cmd=msg.cmd;
      if(cmd==='giveAllWedges'){
        const target=room.players[msg.targetId||pid];
        if(target){if(!target.wedges)target.wedges={};FR.ring.forEach(c=>{target.wedges[c.id]=true;});bcast(room,snap(room));}
      }
      else if(cmd==='clearWedges'){
        const target=room.players[msg.targetId||pid];
        if(target){target.wedges={};bcast(room,snap(room));}
      }
      else if(cmd==='giveWedge'){
        const target=room.players[msg.targetId||pid];
        if(target&&msg.catId){if(!target.wedges)target.wedges={};target.wedges[msg.catId]=true;bcast(room,snap(room));}
      }
      else if(cmd==='teleport'){
        const target=room.players[msg.targetId||pid];
        if(target&&typeof msg.squareId==='number'){target.pos=msg.squareId;target._pendingPos=null;bcast(room,snap(room));}
      }
      else if(cmd==='flagQuestion'){
        if(room.currentQ){
          const flagged={cat:room.currentCatId,isMC:room.isCurrentMC,
            question:room.currentQ.question||room.currentQ.q,
            answer:room.currentQ.answer||room.currentQ.a};
          flagQuestion(flagged);
          removeQuestionFromPool(room.currentCatId,room.isCurrentMC,flagged.question);
          sendTo(ws,{type:'devAck',message:`Flagged & removed: "${(flagged.question||'').slice(0,40)}…"`});
        }
      }
      else if(cmd==='skipQuestion'){
        clrTimer(room);clrAdv(room);
        if(['question','centre_question','steal'].includes(room.state))startTurn(room);
      }
      else if(cmd==='setActivePlayer'){
        if(msg.targetId&&room.players[msg.targetId]){room.activePlayerId=msg.targetId;bcast(room,snap(room));}
      }
      else if(cmd==='endTurn'){clrTimer(room);clrAdv(room);startTurn(room);}
      return;
    }

    else if(msg.type==='resetGame'){
      if(pid!==room.hostId)return;
      clrTimer(room);clrAdv(room);
      const nr=mkRoom(rcode);
      nr.players=room.players;nr.hostId=room.hostId;
      // Fresh game: reset every player's game state but keep identity & connection.
      Object.values(nr.players).forEach(p=>{
        p.pos=0;p.wedges={};p._pendingPos=null;
        if(p._dcTimer){clearTimeout(p._dcTimer);p._dcTimer=null;}
        // Drop players who are still disconnected from the new game's roster handling
      });
      nr.turnOrder=shuffle(Object.keys(nr.players)); // reshuffle for fairness
      nr.round=0;
      rooms[rcode]=nr;bcast(nr,snap(nr));
    }
  });

  ws.on('close',()=>{
    if(!rcode||!rooms[rcode])return;
    const room=rooms[rcode];
    const player=room.players[pid];
    if(!player)return;

    if(room.state==='lobby'){
      // In lobby — remove immediately
      delete room.players[pid];
      const rem=Object.keys(room.players);
      if(!rem.length){clrTimer(room);clrAdv(room);delete rooms[rcode];return;}
      if(room.hostId===pid)room.hostId=rem[0];
      bcast(room,snap(room));
      return;
    }

    // Mid-game — mark as disconnected, keep their slot for 90s to allow reconnect
    player._disconnected=true;
    bcast(room,snap(room));
    console.log(`[DISCONNECT] ${player.name} (${pid}) dropped from ${rcode} — 90s grace`);
    if(player._dcTimer)clearTimeout(player._dcTimer);
    player._dcTimer=setTimeout(()=>{
      const r=rooms[rcode];if(!r)return;
      const p=r.players[pid];
      if(p&&p._disconnected){
        delete r.players[pid];
        const rem=Object.keys(r.players);
        if(!rem.length){clrTimer(r);clrAdv(r);delete rooms[rcode];return;}
        if(r.hostId===pid)r.hostId=rem[0];
        // If it was their turn, advance
        if(r.activePlayerId===pid){clrTimer(r);clrAdv(r);startTurn(r);}
        else bcast(r,snap(r));
        console.log(`[TIMEOUT] ${pid} removed from ${rcode} after grace period`);
      }
    },90000);
  });
});

function resolveChallenge(room){
  // Guard: only run once, only from the voting state
  if(room.state!=='challenge_vote')return;
  if(room._challengeResolved)return;
  room._challengeResolved=true;
  clrTimer(room);clrAdv(room);

  const claimed=room.challengeClaimedWinnerId;
  let agrees=0,disagrees=0;
  (room._voterIds||[]).forEach(id=>{
    const v=room.challengeVotes[id];
    if(v===true)agrees++;
    else if(v===false)disagrees++;
    // unvoted (null) counts as neither — abstention
  });
  // Challenge succeeds only with a strict majority of agrees among cast votes
  const succeeded=agrees>disagrees;

  console.log(`[CHALLENGE] claimed=${claimed} agrees=${agrees} disagrees=${disagrees} → ${succeeded?'OVERRIDE':'rejected'}`);

  if(!room.reveal){
    // Safety: reveal vanished somehow — just move on
    clrChallenge(room);return startTurn(room);
  }
  room.reveal.challengeResult={challengerId:room.challengerId,claimedWinnerId:claimed,agrees,disagrees,succeeded};

  if(succeeded&&claimed&&room.players[claimed]){
    applyOverride(room,claimed);
  }else{
    proceedAfterChallenge(room);
  }
}

server.listen(PORT,()=>console.log(`\n🎯 TriviaWheel → http://localhost:${PORT}\n`));
