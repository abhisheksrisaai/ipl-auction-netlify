// ── Supabase Config ──
const SUPABASE_URL = 'https://uazkhrqevmsijjzcskvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhemtocnFldm1zaWpqemNza3ZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNzE4ODAsImV4cCI6MjEwMDk0Nzg4MH0.Kno5zMRCJQOG9Uc-atkI3vu6gsGqOTCUck-YWfdKE78';

const SB = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Game State ──
const G = {
  room: null, roomCode: '', teamName: '', teamId: '', isAuctioneer: false,
  ownerToken: '', status: 'HOME', teams: [], roster: [], unsold: [],
  trades: [], playerLog: [], players: [], playerMap: {},
  currentBid: 0, currentBidTeam: null, currentPlayer: null, timerEnd: null,
  pollInterval: null, mysteryBatch: [], mysteryIndex: 0,
};

// ── Helpers ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const create = (tag, attrs = {}, content = '') => {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => { if(v !== undefined && v !== null) el[k] = v; });
  if(content) el.innerHTML = content;
  return el;
};

function countryFlag(country) {
  const flags = { IND:'🇮🇳',AUS:'🇦🇺',ENG:'🏴󠁧󠁢󠁥󠁮󠁧󠁿',SA:'🇿🇦',NZ:'🇳🇿',WI:'🏝️',AFG:'🇦🇫',SL:'🇱🇰',BAN:'🇧🇩',ZIM:'🇿🇼',IRE:'🇮🇪' };
  return flags[country] || '🌍';
}

function ovrClass(ovr) {
  if(ovr>=90) return 'ovr-gold'; if(ovr>=85) return 'ovr-purple';
  if(ovr>=80) return 'ovr-blue'; if(ovr>=75) return 'ovr-green'; return 'ovr-gray';
}

function fmtLakhs(n) { return n.toLocaleString('en-IN') + 'L'; }

function toast(msg, type='info') {
  const container = document.getElementById('toast-container') || (()=>{
    const c = create('div',{id:'toast-container'});
    Object.assign(c.style,{position:'fixed',top:'1rem',right:'1rem',zIndex:'3000',display:'flex',flexDirection:'column',gap:'0.5rem'});
    document.body.appendChild(c); return c;
  })();
  const colors = {success:'#00C853',error:'#FF4444',info:'#448AFF',warning:'#FF9800'};
  const t = create('div',{},msg);
  Object.assign(t.style,{
    background:colors[type]||colors.info,color:'#fff',padding:'0.6rem 1.2rem',
    borderRadius:'10px',fontWeight:'700',animation:'slideIn 0.3s',
    boxShadow:'0 4px 12px rgba(0,0,0,0.3)'
  });
  container.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity 0.3s';setTimeout(()=>t.remove(),300)},3000);
}

// ── Confetti ──
function confetti() {
  const colors = ['#FFD700','#FF6B35','#00C853','#448AFF','#AB47BC','#FF4081'];
  for(let i=0;i<60;i++){
    const piece = create('div',{className:'confetti-piece'});
    Object.assign(piece.style,{
      left:Math.random()*100+'%',width:(5+Math.random()*10)+'px',
      height:(5+Math.random()*10)+'px',background:colors[Math.floor(Math.random()*colors.length)],
      borderRadius:Math.random()>0.5?'50%':'2px',
      '--fall-duration':(1.5+Math.random()*2)+'s',
      animationDelay:Math.random()*0.5+'s',
    });
    document.body.appendChild(piece);
    setTimeout(()=>piece.remove(),3000);
  }
}

// ── Polling ──
async function pollRoom() {
  if(!G.roomCode) return;
  try {
    const {data:room} = await SB.from('rooms').select('*').eq('code',G.roomCode).single();
    if(!room) return;
    if(room.status !== G.status){ G.status = room.status; render(); return; }
    G.room = room;
    const [{data:teams},{data:roster},{data:unsold},{data:playerLog}] = await Promise.all([
      SB.from('teams').select('*').eq('room_code',G.roomCode).order('created_at'),
      SB.from('roster').select('*').eq('room_code',G.roomCode),
      SB.from('unsold').select('*').eq('room_code',G.roomCode),
      SB.from('player_log').select('*').eq('room_code',G.roomCode).order('sold_at',{ascending:false}).limit(20),
    ]);
    if(teams) G.teams = teams;
    if(roster) G.roster = roster;
    if(unsold) G.unsold = unsold;
    if(playerLog) G.playerLog = playerLog;
    if(room.current_player_id) {
      G.currentPlayer = G.playerMap[room.current_player_id] || null;
      G.currentBid = room.current_bid_lakhs || 0;
      G.currentBidTeam = room.current_bid_team;
      G.timerEnd = room.timer_end;
    }
    renderSub();
  }catch(e){console.error('poll',e)}
}

// ── RPC helpers ──
async function placeBid(amount) {
  const {data,error} = await SB.rpc('place_bid',{
    p_room:G.roomCode,p_team:G.teamName,
    p_player_id:G.currentPlayer.id,p_amount:amount
  });
  if(error){ toast(error.message,'error'); return null; }
  return data;
}
async function finalizePlayer() {
  const {data} = await SB.rpc('finalize_player',{p_room:G.roomCode});
  return data;
}
async function undoLastSale() {
  const {data} = await SB.rpc('undo_last_sale',{p_room:G.roomCode});
  return data;
}
async function autoFill() {
  const {data} = await SB.rpc('auto_fill_teams',{p_room:G.roomCode});
  return data;
}
async function executeTradeRPC(tradeId) {
  const {data} = await SB.rpc('execute_trade',{p_trade_id:tradeId});
  return data;
}

// ── Navigation ──
function showPage(page) {
  $$('.page').forEach(p => p.classList.add('hidden'));
  const el = document.getElementById('page-'+page);
  if(el) el.classList.remove('hidden');
  document.title = page === 'home' ? 'IPL Mega Auction 2025' : `🏏 ${page} — IPL Auction`;
}

// ── RENDER ──
async function render() {
  const s = G.status;
  if(s === 'HOME' || !G.roomCode) { showPage('home'); renderHome(); return; }
  if(s === 'LOBBY') { showPage('lobby'); renderLobby(); return; }
  if(s === 'AUCTION_LIVE') { showPage('auction'); renderAuction(); return; }
  if(s === 'UNSOLD_ACCELERATED') { showPage('unsold'); renderUnsold(); return; }
  if(s === 'TRADE_WINDOW') { showPage('trade'); renderTrade(); return; }
  if(s === 'XI_SELECTION') { showPage('xi'); renderXI(); return; }
  if(s === 'AI_ANALYSIS' || s === 'DONE') { showPage('analysis'); renderAnalysis(); return; }
}
function renderSub() {
  const s = G.status;
  if(s === 'AUCTION_LIVE') renderAuctionSub();
  else if(s === 'LOBBY') renderLobbySub();
  else if(s === 'UNSOLD_ACCELERATED') renderUnsoldSub();
  else if(s === 'TRADE_WINDOW') renderTradeSub();
}

// ── Particles Background ──
function initParticles() {
  const canvas = document.createElement('canvas');
  canvas.id = 'particles-canvas';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let particles = [];
  function resize(){ canvas.width=window.innerWidth; canvas.height=window.innerHeight; }
  resize(); window.addEventListener('resize',resize);
  for(let i=0;i<50;i++) particles.push({
    x:Math.random()*canvas.width,y:Math.random()*canvas.height,
    r:0.5+Math.random()*1.5,vx:(Math.random()-0.5)*0.3,vy:(Math.random()-0.5)*0.3,
    alpha:0.2+Math.random()*0.4
  });
  function animate(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    particles.forEach(p=>{
      p.x+=p.vx;p.y+=p.vy;
      if(p.x<0)p.x=canvas.width;if(p.x>canvas.width)p.x=0;
      if(p.y<0)p.y=canvas.height;if(p.y>canvas.height)p.y=0;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(255,215,0,${p.alpha})`;ctx.fill();
    });
    requestAnimationFrame(animate);
  }
  animate();
}

// ── Timer Ring SVG ──
function timerRing(remaining,total) {
  const pct = Math.max(0,Math.min(1,remaining/total));
  const dash = pct * 283;
  const color = remaining <= 5 ? 'var(--danger)' : remaining <= 10 ? 'var(--warning)' : 'var(--gold)';
  return `<div class="timer-ring">
    <svg viewBox="0 0 100 100" width="100" height="100">
      <circle class="bg" cx="50" cy="50" r="45"/>
      <circle class="fg${remaining<=5?' urgent':''}" cx="50" cy="50" r="45"
        stroke="${color}" stroke-dasharray="283" stroke-dashoffset="${283-dash}"/>
    </svg>
    <div class="timer-text" style="color:${color}">${Math.ceil(remaining)}</div>
  </div>`;
}

// ── OVR Badge ──
function ovrBadge(ovr) {
  return `<div class="ovr-badge ${ovrClass(ovr)}">${ovr}</div>`;
}

// ── Bid Increment Logic ──
function getMinBid(current,base) {
  if(current===0) return base;
  if(current<100) return current+5;
  if(current<200) return current+10;
  return current+20;
}
function getIncrement(current) {
  if(current===0) return 0; if(current<100) return 5;
  if(current<200) return 10; return 20;
}

// ── Role Color ──
function roleBadge(role) {
  return `<span class="player-role-badge role-${role}">${role}</span>`;
}

// ── Generate Room Code ──
function genCode() {
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let c=''; for(let i=0;i<6;i++) c+=chars[Math.floor(Math.random()*chars.length)];
  return c;
}

// ═══════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════

// ── HOME ──
function renderHome() {
  const el = document.getElementById('page-home');
  const createForm = el.querySelector('#create-form');
  const joinForm = el.querySelector('#join-form');

  createForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = el.querySelector('#create-name').value.trim();
    const timer = parseInt(el.querySelector('#create-timer').value)||15;
    const max = parseInt(el.querySelector('#create-max').value)||10;
    if(!name) return toast('Enter your name','error');
    G.roomCode = genCode();
    const {error} = await SB.from('rooms').insert({
      code:G.roomCode,auctioneer:name,status:'LOBBY',timer_secs:timer,max_teams:max
    });
    if(error) return toast('Failed to create room','error');
    G.isAuctioneer = true; G.teamName = name; G.ownerToken = 'auctioneer_'+G.roomCode;
    const {error:te} = await SB.from('teams').insert({
      room_code:G.roomCode,name:name,owner_token:G.ownerToken
    });
    if(te) return toast('Failed to join own room','error');
    G.status = 'LOBBY'; G.pollInterval = setInterval(pollRoom, 1200);
    await pollRoom(); render();
  };

  joinForm.onsubmit = async (e) => {
    e.preventDefault();
    const code = el.querySelector('#join-code').value.trim().toUpperCase();
    const tname = el.querySelector('#join-team').value.trim();
    if(!code||!tname) return toast('Enter room code and team name','error');
    const {data:room,error} = await SB.from('rooms').select('*').eq('code',code).single();
    if(error||!room) return toast('Room not found','error');
    if(room.status!=='LOBBY') return toast('Auction already started','error');
    G.roomCode = code; G.isAuctioneer = false; G.teamName = tname;
    G.ownerToken = crypto.randomUUID();
    const {error:te2} = await SB.from('teams').insert({
      room_code:code,name:tname,owner_token:G.ownerToken
    });
    if(te2){ G.roomCode=''; return toast(te2.message.includes('duplicate')?'Team name taken!':'Join failed','error'); }
    G.status = 'LOBBY'; G.pollInterval = setInterval(pollRoom, 1200);
    await pollRoom(); render();
  };
}

// ── LOBBY ──
function renderLobby() {
  const el = document.getElementById('page-lobby');
  el.querySelector('#lobby-code').textContent = G.roomCode;
  el.querySelector('#lobby-auctioneer').textContent = G.room?.auctioneer || '';
  renderLobbySub();
}
function renderLobbySub() {
  const el = document.getElementById('page-lobby');
  const grid = el.querySelector('#lobby-team-grid');
  grid.innerHTML = G.teams.map((t,i)=>`
    <div class="team-card glass" style="animation-delay:${i*0.05}s">
      <div style="font-size:1.2rem;font-weight:700">🏏 ${t.name}</div>
      <div class="text-muted text-sm">Joined #${i+1}</div>
    </div>
  `).join('');

  const panel = el.querySelector('#lobby-auctioneer-panel');
  if(G.isAuctioneer) {
    panel.classList.remove('hidden');
    const purse = parseInt(el.querySelector('#lobby-purse').value)||120;
    const canStart = purse > 0 && G.teams.length >= 2;
    el.querySelector('#lobby-purse-display').textContent = `₹${purse} Cr (${purse*100} Lakhs) for ${G.teams.length} teams`;
    el.querySelector('#lobby-start-btn').disabled = !canStart;
  } else {
    panel.classList.add('hidden');
  }
}

async function startAuction() {
  const purseCr = parseInt($('#lobby-purse').value)||120;
  const purseL = purseCr * 100;
  await SB.from('rooms').update({purse_lakhs:purseL,status:'AUCTION_LIVE'}).eq('code',G.roomCode);
  await Promise.all(G.teams.map(t=>
    SB.from('teams').update({purse_left:purseL}).eq('id',t.id)
  ));
  // Load player map
  if(Object.keys(G.playerMap).length===0) {
    const {data} = await SB.from('players').select('*');
    if(data) data.forEach(p=>G.playerMap[p.id]=p);
  }
  G.status = 'AUCTION_LIVE'; pollRoom(); render();
}

// ── AUCTION ──
function renderAuction() {
  const el = document.getElementById('page-auction');
  renderAuctionSub();
}
function renderAuctionSub() {
  const el = document.getElementById('page-auction');
  const player = G.currentPlayer;
  const cpEl = el.querySelector('#auction-player-card');

  const setsEl = el.querySelector('#auction-set-select');
  const playerSelEl = el.querySelector('#auction-player-select');
  const auctioneerControls = el.querySelector('#auctioneer-controls');
  const bidPanel = el.querySelector('#bid-panel');
  const timerArea = el.querySelector('#timer-area');
  const logEl = el.querySelector('#log-container');
  const teamListEl = el.querySelector('#team-list');
  const mysteryBtn = el.querySelector('#mystery-btn');

  // Player card
  if(player) {
    const ovrC = ovrClass(player.ovr);
    const isMystery = player.is_mystery;
    cpEl.innerHTML = `
    <div class="player-card glass" style="border-color:${ovrC==='ovr-gold'?'var(--gold)':ovrC==='ovr-purple'?'var(--purple)':ovrC==='ovr-blue'?'var(--blue)':ovrC==='ovr-green'?'var(--success)':'var(--muted)'};--player-ovr-color:${ovrC==='ovr-gold'?'var(--gold)':ovrC==='ovr-purple'?'var(--purple)':ovrC==='ovr-blue'?'var(--blue)':ovrC==='ovr-green'?'var(--success)':'var(--muted)'}">
      <h2 style="margin:0">${isMystery?'🔮 MYSTERY PLAYER':countryFlag(player.country)+' '+player.name}</h2>
      <p class="player-country">${isMystery?'???' : player.country+' · Set '+player.set_code}</p>
      ${roleBadge(player.role)}
      ${ovrBadge(player.ovr)}
      <p style="margin-top:0.3rem"><strong>Base: ₹${player.base_lakhs}L</strong></p>
      ${isMystery&&player.hint?`<div style="background:rgba(171,71,188,0.15);border-radius:8px;padding:0.5rem;margin-top:0.5rem"><span class="badge badge-mystery">🔮 HINT</span> ${player.hint}</div>`:''}
    </div>`;

    // Timer
    if(G.timerEnd) {
      const remaining = (new Date(G.timerEnd) - new Date()) / 1000;
      if(remaining <= 0) {
        timerArea.innerHTML = '<div style="text-align:center;font-size:2rem;color:var(--danger)">⏰ TIME\'S UP!</div>';
        finalizePlayer().then(r => {
          if(r?.status==='sold'){ confetti(); toast(`SOLD! → ${r.team} for ₹${r.price}L`,'success'); }
          else toast('UNSOLD','warning');
          pollRoom();
        });
      } else {
        timerArea.innerHTML = timerRing(remaining, G.room?.timer_secs||15);
      }
    } else {
      timerArea.innerHTML = '<div class="text-center text-muted">Waiting for auctioneer...</div>';
    }

    // Bid panel
    if(G.room?.current_bid_lakhs > 0) {
      bidPanel.innerHTML = `
        <div class="current-bid">₹${G.currentBid}L</div>
        <div class="current-bid-team">Highest bidder: <strong>${G.currentBidTeam}</strong></div>
      `;
    } else {
      bidPanel.innerHTML = '<div class="text-muted">No bids yet</div>';
    }
    const myTeam = G.teams.find(t=>t.name===G.teamName);
    if(myTeam && !G.isAuctioneer) {
      const nextBid = getMinBid(G.currentBid, player.base_lakhs);
      const inc = getIncrement(G.currentBid);
      const osFull = player.country!=='IND' && myTeam.overseas_count>=8;
      const squadFull = myTeam.squad_size >= 21;
      const noPurse = nextBid > myTeam.purse_left;
      const selfBid = G.currentBidTeam === G.teamName;
      const reason = osFull?'Overseas full':squadFull?'Squad full':noPurse?'Insufficient purse':selfBid?'You are highest bidder':'';

      bidPanel.innerHTML += reason
        ? `<button class="btn btn-primary btn-block mt-1" disabled>🔨 Bid ₹${nextBid}L — ${reason}</button>`
        : `<button class="btn btn-primary btn-block mt-1" onclick="handleBid(${nextBid})">🔨 Bid ₹${nextBid}L ${inc?'(+'+inc+'L)':''}</button>`;
    }
  } else {
    cpEl.innerHTML = '<div class="glass text-center" style="padding:3rem"><p style="font-size:1.5rem;color:var(--muted)">🎯 Select a set and player to begin</p></div>';
    bidPanel.innerHTML = '';
    timerArea.innerHTML = '';
  }

  // Team sidebar
  const purseTotal = G.room?.purse_lakhs || 12000;
  teamListEl.innerHTML = G.teams.map(t => {
    const tr = G.roster.filter(r=>r.team_id===t.id);
    const spent = tr.reduce((s,r)=>s+r.price_lakhs,0);
    const pct = (1 - t.purse_left/purseTotal)*100;
    const color = pct>70?'danger':pct>40?'warning':'';
    return `<div class="team-bar">
      <div class="team-name">${t.name}</div>
      <div class="team-purse">💰${t.purse_left}L</div>
      <div class="team-squad">${t.squad_size}/21 🌍${t.overseas_count}/8</div>
      <div class="progress-bar" style="width:80px"><div class="progress-fill ${color}" style="width:${Math.min(100,pct)}%"></div></div>
    </div>`;
  }).join('');

  // Log
  logEl.innerHTML = G.playerLog.slice(0,15).map(l=>{
    const p = G.playerMap[l.player_id] || {};
    if(l.sold_to) {
      const tm = G.teams.find(t=>t.id===l.sold_to);
      return `<div class="log-entry log-sold">✅ ${p.name||l.player_id} → ${tm?.name||'?'} for ₹${l.price_lakhs}L</div>`;
    }
    return `<div class="log-entry log-unsold">❌ ${p.name||l.player_id} — UNSOLD</div>`;
  }).join('');

  // Auctioneer controls
  if(G.isAuctioneer) {
    auctioneerControls.classList.remove('hidden');

    // Build set selector
    const allSets = [...new Set(Object.values(G.playerMap).map(p=>p.set_code))].filter(s=>s!=='LEG');
    setsEl.innerHTML = '<option value="">— Jump to Set —</option>'+allSets.map(s=>`<option value="${s}">${s}</option>`).join('');
    setsEl.onchange = () => {
      const set = setsEl.value;
      if(!set) { playerSelEl.innerHTML='<option value="">—</option>'; return; }
      const setPlayers = Object.values(G.playerMap).filter(p=>p.set_code===set);
      playerSelEl.innerHTML = '<option value="">— Select Player —</option>'+setPlayers.map(p=>
        `<option value="${p.id}">${p.name} (${countryFlag(p.country)} ${p.role} OVR${p.ovr} Base₹${p.base_lakhs}L)</option>`
      ).join('');
    };

    mysteryBtn.onclick = async () => {
      const mystery = Object.values(G.playerMap).filter(p=>p.is_mystery);
      if(!mystery.length) return toast('No mystery players left','warning');
      const chosen = mystery.sort(()=>Math.random()-0.5).slice(0,Math.min(5,mystery.length));
      const timerSecs = G.room?.timer_secs||15;
      const timerEnd = new Date(Date.now()+timerSecs*1000).toISOString();
      await SB.from('rooms').update({
        current_set:'LEG',current_player_id:chosen[0].id,
        current_bid_lakhs:0,current_bid_team:null,timer_end:timerEnd
      }).eq('code',G.roomCode);
      G.mysteryBatch = chosen.map(p=>p.id);
      G.mysteryIndex = 0;
      toast(`🔮 ${chosen.length} mystery legends injected!`,'warning');
      pollRoom();
    };
  } else {
    auctioneerControls.classList.add('hidden');
  }
}

async function handleBid(amount) {
  const result = await placeBid(amount);
  if(result?.ok){ toast(`Bid: ₹${amount}L`,'success'); pollRoom(); }
  else toast(result?.reason||'Bid failed','error');
}

async function handleSetPlayer() {
  const pid = $('#auction-player-select').value;
  const set = $('#auction-set-select').value;
  if(!pid) return toast('Select a player','error');
  const timerSecs = G.room?.timer_secs||15;
  const timerEnd = new Date(Date.now()+timerSecs*1000).toISOString();
  await SB.from('rooms').update({
    current_set:set,current_player_id:pid,current_bid_lakhs:0,
    current_bid_team:null,timer_end:timerEnd
  }).eq('code',G.roomCode);
  pollRoom();
}

async function handleSkip() {
  await finalizePlayer();
  await SB.from('rooms').update({current_player_id:null,current_bid_lakhs:0,current_bid_team:null,timer_end:null}).eq('code',G.roomCode);
  pollRoom();
}

async function handleForceSell() { await finalizePlayer(); pollRoom(); }

async function handleSendUnsold() {
  await SB.from('rooms').update({current_bid_lakhs:0,current_bid_team:null}).eq('code',G.roomCode);
  await finalizePlayer();
  await SB.from('rooms').update({current_player_id:null,current_bid_lakhs:0,current_bid_team:null,timer_end:null}).eq('code',G.roomCode);
  pollRoom();
}

async function handleUndo() {
  const r = await undoLastSale();
  if(r?.ok){ toast(`↩️ Undone: ${r.player_id}`,'warning'); pollRoom(); }
  else toast(r?.reason||'Undo failed','error');
}

async function handleEndAuction() {
  await SB.from('rooms').update({
    status:'UNSOLD_ACCELERATED',current_player_id:null,
    current_bid_lakhs:0,current_bid_team:null,timer_end:null
  }).eq('code',G.roomCode);
  G.status='UNSOLD_ACCELERATED'; render();
}

// ── UNSOLD ACCELERATED ──
let unsoldBatch=[], unsoldBatchIdx=0, unsoldTimerEnd=null;
function renderUnsold() {
  const el = document.getElementById('page-unsold');
  const unsoldPids = new Set(G.unsold.map(u=>u.player_id));
  const remaining = Object.values(G.playerMap).filter(p=>unsoldPids.has(p.id));
  el.querySelector('#unsold-count').textContent = remaining.length;

  if(!G.isAuctioneer) {
    el.querySelector('#unsold-auctioneer').classList.add('hidden');
    return;
  }
  el.querySelector('#unsold-auctioneer').classList.remove('hidden');

  // Batch setup
  if(!unsoldBatch.length && remaining.length) {
    unsoldBatch = [];
    for(let i=0;i<remaining.length;i+=3) unsoldBatch.push(remaining.slice(i,i+3));
    unsoldBatchIdx=0;
  }

  if(unsoldBatchIdx >= unsoldBatch.length) {
    el.querySelector('#unsold-cards').innerHTML='<p class="text-center" style="color:var(--success)">✅ All unsold processed!</p>';
    return;
  }
  renderUnsoldSub();
}
function renderUnsoldSub() {
  const batch = unsoldBatch[unsoldBatchIdx]||[];
  const el = document.getElementById('page-unsold');
  el.querySelector('#unsold-cards').innerHTML = batch.map(p=>{
    const halfBase = Math.floor(p.base_lakhs/2);
    return `<div class="player-card glass" style="--player-ovr-color:${ovrClass(p.ovr)}">
      <h3>${countryFlag(p.country)} ${p.name}</h3>
      ${roleBadge(p.role)} ${ovrBadge(p.ovr)}
      <p>Base: <s>₹${p.base_lakhs}L</s> → <strong>₹${halfBase}L</strong> (50% off)</p>
      ${!G.isAuctioneer?`<button class="btn btn-primary btn-sm mt-1" onclick="unsoldBid('${p.id}',${halfBase})">🔨 Bid ₹${halfBase}L</button>`:''}
    </div>`;
  }).join('');
}
async function unsoldBid(pid,amount) {
  await SB.from('rooms').update({current_player_id:pid,current_bid_lakhs:0,current_bid_team:null}).eq('code',G.roomCode);
  const r = await placeBid(amount);
  if(r?.ok) toast(`Bid: ₹${amount}L`,'success');
  else toast(r?.reason||'Failed','error');
}
async function skipUnsoldBatch() {
  unsoldBatchIdx++; unsoldTimerEnd=null;
  if(unsoldBatchIdx >= unsoldBatch.length) {
    G.status='TRADE_WINDOW';
    await SB.from('rooms').update({status:'TRADE_WINDOW'}).eq('code',G.roomCode);
    unsoldBatch=[]; unsoldBatchIdx=0;
  }
  render();
}
async function finishUnsold() {
  await SB.from('rooms').update({status:'TRADE_WINDOW'}).eq('code',G.roomCode);
  G.status='TRADE_WINDOW'; unsoldBatch=[]; unsoldBatchIdx=0; render();
}

// ── TRADE ──
function renderTrade() {
  const el = document.getElementById('page-trade');
  const myTeam = G.teams.find(t=>t.name===G.teamName);
  if(!myTeam) return;
  const myRoster = G.roster.filter(r=>r.team_id===myTeam.id);
  const otherTeams = G.teams.filter(t=>t.id!==myTeam.id);

  el.querySelector('#trade-my-players').innerHTML = myRoster.map(r=>{
    const p = G.playerMap[r.player_id]||{};
    return `<option value="${r.player_id}">${p.name||r.player_id} (OVR ${p.ovr||'?'})</option>`;
  }).join('');

  el.querySelector('#trade-target-team').innerHTML = '<option value="">— Select Team —</option>'
    +otherTeams.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');

  el.querySelector('#trade-target-team').onchange = () => {
    const tid = el.querySelector('#trade-target-team').value;
    const tRoster = G.roster.filter(r=>r.team_id===tid);
    el.querySelector('#trade-want-player').innerHTML = '<option value="">— Select Player —</option>'
      +tRoster.map(r=>{
        const p = G.playerMap[r.player_id]||{};
        return `<option value="${r.player_id}">${p.name||r.player_id} (OVR ${p.ovr||'?'})</option>`;
      }).join('');
  };

  // Incoming offers
  el.querySelector('#trade-offers').innerHTML = G.trades.filter(tr=>tr.status==='pending'&&tr.to_team===myTeam.id).map(tr=>{
    const fromT = G.teams.find(t=>t.id===tr.from_team);
    const gp = G.playerMap[tr.give_player]||{};
    const wp = G.playerMap[tr.want_player]||{};
    return `<div class="glass" style="padding:0.8rem;margin:0.3rem 0">
      <strong>${fromT?.name||'?'}</strong> offers: <em>${gp.name||tr.give_player}</em> ↔ <em>${wp.name||tr.want_player}</em>
      <div class="flex-center gap-1 mt-1">
        <button class="btn btn-primary btn-sm" onclick="acceptTrade('${tr.id}')">✅ Accept</button>
        <button class="btn btn-danger btn-sm" onclick="rejectTrade('${tr.id}')">❌ Reject</button>
      </div>
    </div>`;
  }).join('') || '<p class="text-muted">No incoming offers</p>';

  if(G.isAuctioneer) el.querySelector('#trade-end-btn').classList.remove('hidden');
  else el.querySelector('#trade-end-btn').classList.add('hidden');
  renderTradeSub();
}
function renderTradeSub() {
  const el = document.getElementById('page-trade');
  // Suggestions
  const suggestions = G.teams.filter(t=>{
    const tr = G.roster.filter(r=>r.team_id===t.id);
    const roles = {}; tr.forEach(r=>{const p=G.playerMap[r.player_id];if(p)roles[p.role]=(roles[p.role]||0)+1;});
    return !roles.WK||(roles.BOWL||0)<2||(roles.AR||0)<1;
  });
  el.querySelector('#trade-suggestions').innerHTML = suggestions.map(t=>{
    const tr = G.roster.filter(r=>r.team_id===t.id);
    const roles = {}; tr.forEach(r=>{const p=G.playerMap[r.player_id];if(p)roles[p.role]=(roles[p.role]||0)+1;});
    const warns = [];
    if(!roles.WK) warns.push('No wicketkeeper!');
    if((roles.BOWL||0)<2) warns.push('Low on bowlers');
    if((roles.AR||0)<1) warns.push('Needs all-rounder');
    return warns.length?`<div class="text-sm" style="margin:0.2rem 0">⚠️ <strong>${t.name}</strong>: ${warns.join(' | ')}</div>`:'';
  }).join('') || '<p class="text-muted text-sm">All teams look balanced</p>';
}

async function proposeTrade() {
  const fromTeam = G.teams.find(t=>t.name===G.teamName);
  const toTeam = $('#trade-target-team').value;
  const giveP = $('#trade-my-players').value;
  const wantP = $('#trade-want-player').value;
  if(!toTeam||!giveP||!wantP) return toast('Fill all fields','error');
  if(fromTeam.trades_used>=2) return toast('You reached max 2 trades','error');
  const toT = G.teams.find(t=>t.id===toTeam);
  if(toT.trades_used>=2) return toast(`${toT.name} reached max 2 trades`,'error');
  const {error} = await SB.from('trades').insert({
    room_code:G.roomCode,from_team:fromTeam.id,to_team:toTeam,
    give_player:giveP,want_player:wantP,status:'pending'
  });
  if(error) return toast('Trade proposal failed','error');
  toast('Trade proposed!','success'); pollRoom();
}
async function acceptTrade(tid) {
  const r = await executeTradeRPC(tid);
  if(r?.ok){ toast('Trade executed!','success'); confetti(); pollRoom(); }
  else toast(r?.reason||'Trade failed','error');
}
async function rejectTrade(tid) {
  await SB.from('trades').update({status:'rejected'}).eq('id',tid);
  pollRoom();
}
async function endTrade() {
  // Auto-fill first
  await autoFill();
  await SB.from('rooms').update({status:'XI_SELECTION'}).eq('code',G.roomCode);
  G.status='XI_SELECTION'; render();
}

// ── XI SELECTION ──
function renderXI() {
  const el = document.getElementById('page-xi');
  const myTeam = G.teams.find(t=>t.name===G.teamName);
  if(!myTeam) return;
  const myRoster = G.roster.filter(r=>r.team_id===myTeam.id);
  const pids = new Set(myRoster.map(r=>r.player_id));
  // Enrich roster with player names
  myRoster.forEach(r=>{ if(!r._player) r._player=G.playerMap[r.player_id]||{}; });

  el.querySelector('#xi-team-name').textContent = `Your XI: ${myTeam.name}`;
  el.querySelector('#xi-player-count').textContent = `(${myRoster.length} players)`;

  el.querySelector('#xi-checklist').innerHTML = myRoster.map((r,i)=>{
    const p = r._player;
    return `<label class="team-bar" style="cursor:pointer">
      <input type="checkbox" class="xi-check" value="${r.player_id}" onchange="updateXICount()">
      <span>${countryFlag(p.country||'')} <strong>${p.name||r.player_id}</strong></span>
      <span class="player-role-badge role-${p.role||'BAT'}" style="font-size:0.65rem">${p.role||'?'}</span>
      <span style="color:${ovrClass(p.ovr||70)}">${p.ovr||'?'}</span>
      <span class="text-muted text-sm">₹${r.price_lakhs}L</span>
    </label>`;
  }).join('');
}

function updateXICount() {
  const checked = $$('.xi-check:checked');
  const osCount = Array.from(checked).filter(cb=>{
    const pid=cb.value; const r=G.roster.find(r=>r.player_id===pid);
    return r&&(G.playerMap[pid]||{}).country!=='IND';
  }).length;
  $('#xi-count').textContent = `${checked.length}/11 · 🌍 ${osCount}/4`;
  $('#xi-save-btn').disabled = checked.length!==11 || osCount>4;
}

async function saveXI() {
  const checked = $$('.xi-check:checked');
  const pids = Array.from(checked).map(c=>c.value);
  const myTeam = G.teams.find(t=>t.name===G.teamName);
  const cap = pids[0]||null, vc = pids[1]||null;
  await SB.from('xis').upsert({
    room_code:G.roomCode,team_id:myTeam.id,
    player_ids:pids,captain_id:cap,vice_captain_id:vc
  });
  confetti(); toast('XI Saved!','success');
}

async function endXI() {
  await SB.from('rooms').update({status:'AI_ANALYSIS'}).eq('code',G.roomCode);
  G.status='AI_ANALYSIS'; render();
}

// ── ANALYSIS ──
function renderAnalysis() {
  const el = document.getElementById('page-analysis');
  if(G.isAuctioneer && !el.querySelector('#analysis-content').innerHTML) {
    el.querySelector('#analysis-run-btn').classList.remove('hidden');
  }
}

async function runAnalysis() {
  const el = document.getElementById('page-analysis');
  el.querySelector('#analysis-run-btn').classList.add('hidden');
  el.querySelector('#analysis-content').innerHTML = '<p class="text-center">Analyzing squads...</p>';

  // Build simple leaderboard (fallback scorer)
  const results = G.teams.map(team=>{
    const tr = G.roster.filter(r=>r.team_id===team.id);
    if(!tr.length) return {team,score:0,avg:0,spent:0};
    const ovrs = tr.map(r=>G.playerMap[r.player_id]?.ovr||70).filter(Boolean);
    const avg = ovrs.reduce((a,b)=>a+b,0)/ovrs.length;
    const spent = tr.reduce((s,r)=>s+r.price_lakhs,0);
    const roles = {}; tr.forEach(r=>{const p=G.playerMap[r.player_id];if(p)roles[p.role]=(roles[p.role]||0)+1;});
    let score = 40 + Math.min(15,avg-70) + Math.min(5,roles.WK||0)
      + Math.min(10,(roles.AR||0)/2) + Math.min(5,tr.filter(r=>(G.playerMap[r.player_id]||{}).country==='IND').length/3);
    score = Math.max(0,Math.min(100,Math.round(score)));
    return {team,score,avg:avg.toFixed(1),spent};
  }).sort((a,b)=>b.score-a.score);

  el.querySelector('#analysis-content').innerHTML = `
    <h3 style="color:var(--gold)">🏆 Leaderboard</h3>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <tr style="border-bottom:1px solid rgba(255,255,255,0.1)"><th style="padding:0.5rem;text-align:left">Rank</th><th>Team</th><th>Score</th><th>Avg OVR</th><th>Spent</th></tr>
      ${results.map((r,i)=>`<tr style="border-bottom:1px solid rgba(255,255,255,0.05);${i===0?'background:rgba(255,215,0,0.08)':''}">
        <td style="padding:0.5rem">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</td>
        <td><strong>${r.team.name}</strong></td><td style="color:var(--gold)">${r.score}/100</td>
        <td>${r.avg}</td><td>₹${r.spent}L</td>
      </tr>`).join('')}
    </table></div>
    ${results.length?`
      <div class="glass mt-2" style="padding:1rem">
        <p>🏆 <strong>Best Squad:</strong> ${results[0].team.name} (${results[0].score}/100)</p>
        <p>⚖️ <strong>Best Balanced:</strong> ${results[0].team.name}</p>
      </div>
    `:''}
    <p class="text-muted text-sm mt-1">*Rule-based scoring. Add LLM key for AI analysis.</p>
  `;

  if(G.isAuctioneer) {
    const btn = create('button',{className:'btn btn-primary btn-block mt-2',onclick:()=>endAuction()},'🏁 Finish Auction');
    el.querySelector('#analysis-content').appendChild(btn);
  }
}

async function endAuction() {
  await SB.from('rooms').update({status:'DONE'}).eq('code',G.roomCode);
  G.status='DONE'; render();
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  showPage('home');
  renderHome();
});

// ── Window: global handlers ──
window.handleBid = handleBid;
window.handleSetPlayer = handleSetPlayer;
window.handleSkip = handleSkip;
window.handleForceSell = handleForceSell;
window.handleSendUnsold = handleSendUnsold;
window.handleUndo = handleUndo;
window.handleEndAuction = handleEndAuction;
window.startAuction = startAuction;
window.updateXICount = updateXICount;
window.saveXI = saveXI;
window.endXI = endXI;
window.runAnalysis = runAnalysis;
window.proposeTrade = proposeTrade;
window.acceptTrade = acceptTrade;
window.rejectTrade = rejectTrade;
window.endTrade = endTrade;
window.skipUnsoldBatch = skipUnsoldBatch;
window.finishUnsold = finishUnsold;
window.unsoldBid = unsoldBid;
