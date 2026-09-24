(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const bounceBtn = $('bounceBtn');
  const overlay = $('overlay');
  const pauseBtn = $('pauseBtn');
  const distanceEl = $('distance');
  const bestDistanceEl = $('bestDistance');
  const bestCarrotsEl = $('bestCarrots');
  const carrotsEl = $('carrots');
  const statusCaption = $('statusCaption');
  const dangerEl = $('danger');
  const scorecardBackdrop = $('scorecardBackdrop');
  const scorecard = $('scorecard');
  const cardCtx = scorecard.getContext('2d');
  const cardDistance = $('cardDistance');
  const cardCarrots = $('cardCarrots');
  const gameShell = $('gameShell');

  const DPR_CAP = 2;
  const METERS_PER_PIXEL = 0.035;
  const GRAVITY = 2140;
  const JUMP_VY = -675;
  const HOLD_ACCEL = -1220;
  const MAX_HOLD = 0.27;
  const PLAYER_X_RATIO = 0.30;
  const INTRO_SECONDS = 1.55;
  const START_SPEED = 410;
  const CRASH_SECONDS = 0.72;
  const STORAGE_KEY = 'belly-bounce-best-v1';

  const founderImg = new Image();
  founderImg.src = './assets/sprites/founder-push.png';

  const obstacleKinds = [
    {kind:'crate', w:56, h:54},
    {kind:'crateStack', w:74, h:88},
    {kind:'pipe', w:92, h:48},
    {kind:'barrels', w:88, h:62},
    {kind:'gears', w:80, h:58},
    {kind:'beam', w:112, h:34},
    {kind:'cart', w:104, h:74},
    {kind:'vent', w:72, h:60}
  ];

  const state = {
    phase:'idle', // idle, intro, playing, crashed
    paused:false,
    t:0,
    introT:0,
    crashT:0,
    scrollX:0,
    distance:0,
    carrots:0,
    speed:START_SPEED,
    y:0,
    vy:0,
    grounded:true,
    pressing:false,
    holdT:0,
    jumpAge:0,
    landSquash:0,
    launchSquash:0,
    crashSpin:0,
    nextObstacleX:780,
    obstacles:[],
    pickups:[],
    dust:[],
    seed:(Math.random()*1e9)|0,
    lastTs:performance.now(),
    viewW:1536,
    viewH:410,
    newRecordShown:false,
    flashT:0,
    shake:0,
    lastResult:null
  };

  function rnd(a,b){
    state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
    return a + (state.seed / 4294967296) * (b-a);
  }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function easeOutCubic(t){ return 1-Math.pow(1-t,3); }

  function best(){
    try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch{return null;}
  }
  function saveBest(result){
    const old=best();
    if(!old || result.distance>old.distance || (result.distance===old.distance && result.carrots>old.carrots)){
      localStorage.setItem(STORAGE_KEY,JSON.stringify(result));
      return true;
    }
    return false;
  }

  function resizeCanvas(){
    const rect=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,DPR_CAP);
    const w=Math.max(1,Math.round(rect.width));
    const h=Math.max(1,Math.round(rect.height));
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){
      canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr);
    }
    state.viewW=w; state.viewH=h;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.imageSmoothingEnabled=true;
  }

  function difficulty(){
    // Reaches the serious competitive band around 100-120s, then keeps tightening slowly.
    const main=clamp(state.t/125,0,1);
    const overtime=Math.max(0,state.t-125);
    return clamp(main + Math.log1p(overtime/45)*0.16,0,1.35);
  }
  function currentSpeed(){
    const d=difficulty();
    return START_SPEED + 430*Math.pow(Math.min(d,1),1.05) + Math.max(0,d-1)*130;
  }
  function gapSeconds(){
    const d=Math.min(1,difficulty());
    return rnd(1.62-0.64*d,2.45-1.02*d);
  }
  function groundY(x){
    const W=state.viewW,H=state.viewH;
    const slope=.235;
    return H*.47 + (x/W)*H*slope;
  }
  function playerBaseY(){ return groundY(state.viewW*PLAYER_X_RATIO)-5; }

  function resetWorld(){
    state.t=0; state.scrollX=0; state.distance=0; state.carrots=0; state.speed=START_SPEED;
    state.y=0; state.vy=0; state.grounded=true; state.pressing=false; state.holdT=0; state.jumpAge=0;
    state.landSquash=0; state.launchSquash=0; state.crashSpin=0;
    state.obstacles.length=0; state.pickups.length=0; state.dust.length=0;
    state.nextObstacleX=state.viewW+420; state.seed=(Math.random()*1e9)|0;
    state.newRecordShown=false; state.flashT=0; state.shake=0; state.lastResult=null;
    dangerEl.classList.remove('show'); dangerEl.textContent='';
    bounceBtn.classList.remove('active'); pauseBtn.textContent='Ⅱ';
    updateHUD();
  }

  function start(){
    resetWorld();
    overlay.hidden=true;
    state.phase='intro'; state.introT=0; state.paused=false;
    statusCaption.textContent='MANAGEMENT ASSISTANCE';
  }

  function beginJump(){
    if(state.phase!=='playing'||state.paused||!state.grounded) return;
    state.grounded=false;
    state.vy=JUMP_VY;
    state.holdT=0;
    state.jumpAge=0;
    state.launchSquash=.12;
    state.shake=Math.max(state.shake,1.6);
    spawnDust(state.viewW*PLAYER_X_RATIO,playerBaseY()+4,5);
  }
  function pressBounce(){
    if(state.phase==='idle'){ start(); return; }
    if(state.phase!=='playing'||state.paused) return;
    if(!state.pressing){
      state.pressing=true;
      bounceBtn.classList.add('active');
      beginJump();
    }
  }
  function releaseBounce(){
    state.pressing=false;
    bounceBtn.classList.remove('active');
  }

  function spawnDust(x,y,n=4){
    for(let i=0;i<n;i++) state.dust.push({x,y,vx:rnd(-55,15),vy:rnd(-70,-20),life:rnd(.22,.52),r:rnd(2,6)});
  }

  function spawnObstacle(worldX, forcedKind=null){
    const d=Math.min(1,difficulty());
    let choices=obstacleKinds.slice(0, d<.18?3 : d<.42?5 : obstacleKinds.length);
    const base=forcedKind ? obstacleKinds.find(o=>o.kind===forcedKind) : choices[Math.floor(rnd(0,choices.length))];
    const scale=rnd(.90,1.08);
    const o={kind:base.kind,x:worldX,w:base.w*scale,h:base.h*scale,passed:false};
    state.obstacles.push(o);
    return o;
  }

  function spawnCarrot(worldX,height=75){
    state.pickups.push({x:worldX,yOff:height,spin:rnd(0,Math.PI*2),taken:false});
  }

  function ensureWorld(){
    const right=state.scrollX+state.viewW+600;
    while(state.nextObstacleX<right){
      const d=Math.min(1,difficulty());
      const speed=Math.max(START_SPEED,state.speed);
      let x=state.nextObstacleX;
      const first=spawnObstacle(x);

      // A carrot before, over, or just after an obstacle. Later runs tempt greed more aggressively.
      const carrotMode=rnd(0,1);
      if(carrotMode<.34) spawnCarrot(x-rnd(120,180),rnd(55,95));
      else if(carrotMode<.76) spawnCarrot(x+first.w*.45,rnd(95,145));
      else spawnCarrot(x+first.w+rnd(85,150),rnd(55,105));

      // From ~40s onwards, some readable two-piece patterns appear. Distances are deliberately
      // chosen so a committed long bounce can clear the whole pattern, while a short bounce can
      // land between wider patterns. Never generate a wall that is mathematically impossible.
      if(d>.30 && rnd(0,1)<(.12+.30*d)){
        const patternGap=rnd(250,360);
        const second=spawnObstacle(x+first.w+patternGap);
        if(rnd(0,1)<.72) spawnCarrot(x+first.w+patternGap*.55,rnd(105,155));
        x += first.w+patternGap+second.w;
      }else{
        x += first.w;
      }

      const seconds=gapSeconds();
      state.nextObstacleX = x + speed*seconds;
    }
  }

  function playerHitbox(){
    const x=state.viewW*PLAYER_X_RATIO;
    const base=playerBaseY()+state.y;
    // Belly-forward, forgiving collision box: visual character is bigger than the lethal core.
    return {x:x-49,y:base-47,w:98,h:41};
  }
  function obstacleHitbox(o){
    const sx=o.x-state.scrollX;
    const y=groundY(sx);
    const pad=o.kind==='beam'?7:5;
    return {x:sx+pad,y:y-o.h+pad,w:o.w-pad*2,h:o.h-pad};
  }
  function overlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}

  function crash(){
    if(state.phase!=='playing') return;
    state.phase='crashed'; state.crashT=0; state.pressing=false; bounceBtn.classList.remove('active');
    state.vy=-250; state.crashSpin=rnd(-2.2,2.2); state.shake=11;
    statusCaption.textContent='TERMINATED';
    dangerEl.textContent='SHIFT TERMINATED'; dangerEl.classList.add('show');
    const result={distance:Math.floor(state.distance),carrots:state.carrots,time:+state.t.toFixed(2)};
    result.newBest=saveBest(result); state.lastResult=result;
    updateHUD(); renderLeaderboard();
  }

  function updatePlaying(dt){
    state.t+=dt;
    state.speed=currentSpeed();
    state.scrollX+=state.speed*dt;
    state.distance=state.scrollX*METERS_PER_PIXEL;
    ensureWorld();

    if(!state.grounded){
      state.jumpAge+=dt;
      if(state.pressing && state.holdT<MAX_HOLD && state.vy<80){
        state.holdT+=dt;
        state.vy += HOLD_ACCEL*dt;
      }
      state.vy += GRAVITY*dt;
      state.y += state.vy*dt;
      if(state.y>=0){
        state.y=0; state.vy=0; state.grounded=true; state.landSquash=.15;
        spawnDust(state.viewW*PLAYER_X_RATIO,playerBaseY()+4,7);
        state.shake=Math.max(state.shake,3.0);
      }
    }

    state.launchSquash=Math.max(0,state.launchSquash-dt);
    state.landSquash=Math.max(0,state.landSquash-dt);
    state.flashT=Math.max(0,state.flashT-dt);
    state.shake=Math.max(0,state.shake-22*dt);

    const p=playerHitbox();
    for(const o of state.obstacles){
      const sx=o.x-state.scrollX;
      if(sx<-180) continue;
      if(overlap(p,obstacleHitbox(o))){crash();return;}
    }

    for(const carrot of state.pickups){
      if(carrot.taken) continue;
      const sx=carrot.x-state.scrollX;
      const cy=groundY(sx)-carrot.yOff;
      const dx=(state.viewW*PLAYER_X_RATIO)-sx;
      const dy=(playerBaseY()+state.y-35)-cy;
      if(dx*dx+dy*dy<44*44){
        carrot.taken=true; state.carrots++; state.flashT=.14;
        spawnDust(sx,cy,8); state.shake=Math.max(state.shake,1.2);
      }
    }

    const b=best();
    if(b && !state.newRecordShown && state.distance>b.distance){
      state.newRecordShown=true;
      dangerEl.textContent='NEW RECORD'; dangerEl.classList.add('show');
      setTimeout(()=>{if(state.phase==='playing') dangerEl.classList.remove('show');},850);
    }

    // prune
    state.obstacles=state.obstacles.filter(o=>o.x-state.scrollX>-240);
    state.pickups=state.pickups.filter(c=>!c.taken && c.x-state.scrollX>-180);

    for(const d of state.dust){d.x+=d.vx*dt;d.y+=d.vy*dt;d.vy+=170*dt;d.life-=dt;}
    state.dust=state.dust.filter(d=>d.life>0);
    updateHUD();
  }

  function update(dt){
    if(state.paused) return;
    if(state.phase==='intro'){
      state.introT+=dt;
      state.shake=Math.max(0,state.shake-20*dt);
      if(state.introT>=INTRO_SECONDS){
        state.phase='playing'; state.t=0; statusCaption.textContent='SLIDING';
        state.launchSquash=.16; spawnDust(state.viewW*PLAYER_X_RATIO,playerBaseY(),9);
      }
      return;
    }
    if(state.phase==='playing'){updatePlaying(dt);return;}
    if(state.phase==='crashed'){
      state.crashT+=dt;
      state.vy+=GRAVITY*.65*dt;
      state.y+=state.vy*dt;
      if(state.y>12) state.y=12;
      state.shake=Math.max(0,state.shake-18*dt);
      if(state.crashT>=CRASH_SECONDS && state.lastResult){
        dangerEl.classList.remove('show');
        showScorecard(state.lastResult);
        state.lastResult=null;
      }
    }
  }

  function drawSky(W,H){
    const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#2a1b18');g.addColorStop(.52,'#5b3523');g.addColorStop(1,'#3a2418');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    // distant haze
    ctx.fillStyle='rgba(224,174,99,.08)';ctx.fillRect(0,H*.30,W,H*.35);
  }

  function drawFactoryBack(W,H){
    const px=-(state.scrollX*.10)%460;
    ctx.save();ctx.globalAlpha=.82;
    for(let i=-1;i<5;i++){
      const x=px+i*460;
      ctx.fillStyle='#1b1512';ctx.fillRect(x,H*.08,310,H*.43);
      ctx.fillStyle='#2e211b';ctx.fillRect(x+22,H*.15,265,H*.36);
      ctx.fillStyle='#17100e';
      for(let w=0;w<4;w++)ctx.fillRect(x+45+w*58,H*.20,29,52);
      ctx.fillStyle='#74422b';ctx.fillRect(x+300,H*.04,34,H*.46);
      ctx.fillStyle='#d3aa62';ctx.fillRect(x+306,H*.04,5,H*.46);
      ctx.fillStyle='#231614';ctx.fillRect(x+315,H*.04,9,H*.46);
      ctx.fillStyle='#7f3128';ctx.fillRect(x+357,H*.12,28,H*.38);
      ctx.fillStyle='#e2d1a4';for(let k=0;k<5;k++)ctx.fillRect(x+357,H*.12+k*54,28,22);
    }
    // catwalk
    ctx.strokeStyle='#9c7140';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,H*.32);ctx.lineTo(W,H*.32);ctx.stroke();
    ctx.lineWidth=2;for(let x=0;x<W;x+=70){ctx.beginPath();ctx.moveTo(x,H*.32);ctx.lineTo(x,H*.26);ctx.stroke();}
    ctx.restore();
  }

  function drawSlope(W,H){
    const leftY=groundY(0),rightY=groundY(W);
    ctx.save();
    ctx.beginPath();ctx.moveTo(0,leftY);ctx.lineTo(W,rightY);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();
    const dirt=ctx.createLinearGradient(0,leftY,0,H);dirt.addColorStop(0,'#67402a');dirt.addColorStop(.22,'#3b281d');dirt.addColorStop(1,'#17100c');ctx.fillStyle=dirt;ctx.fill();
    ctx.strokeStyle='#bc8145';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,leftY);ctx.lineTo(W,rightY);ctx.stroke();
    // scrolling scrap streaks along the hill
    ctx.strokeStyle='rgba(195,137,72,.22)';ctx.lineWidth=2;
    const off=-(state.scrollX*.78)%130;
    for(let x=off-130;x<W+160;x+=130){
      const y=groundY(x)+rndVisual(x)*34+25;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+70,y+16);ctx.stroke();
    }
    // scattered rivets / stones
    for(let i=0;i<20;i++){
      const x=((i*197 + (state.scrollX*.55))%(W+140))-70;
      const y=groundY(x)+28+(i%5)*18;
      ctx.fillStyle=i%3===0?'#8a5a33':'#2c211a';ctx.beginPath();ctx.arc(x,y,3+(i%4),0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
  function rndVisual(x){ return (Math.sin(x*.031+2.1)+1)*.5; }

  function drawCarrot(x,y,rot=0,scale=1){
    ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.scale(scale,scale);
    ctx.fillStyle='#e7b63c';ctx.beginPath();ctx.moveTo(-9,-10);ctx.lineTo(11,-7);ctx.lineTo(1,22);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#ffd875';ctx.lineWidth=2;ctx.stroke();
    ctx.strokeStyle='#7c9a43';ctx.lineWidth=5;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-3,-10);ctx.lineTo(-10,-22);ctx.moveTo(2,-10);ctx.lineTo(5,-24);ctx.moveTo(6,-9);ctx.lineTo(14,-20);ctx.stroke();ctx.restore();
  }

  function drawObstacle(o){
    const x=o.x-state.scrollX,y=groundY(x);
    ctx.save();ctx.translate(x,y);
    switch(o.kind){
      case 'crate':case 'crateStack':{
        const levels=o.kind==='crateStack'?2:1, eachH=o.h/levels;
        for(let l=0;l<levels;l++){
          const yy=-eachH*(l+1);ctx.fillStyle='#6f4628';ctx.fillRect(0,yy,o.w,eachH-2);ctx.strokeStyle='#b27a42';ctx.lineWidth=3;ctx.strokeRect(2,yy+2,o.w-4,eachH-6);ctx.beginPath();ctx.moveTo(4,yy+4);ctx.lineTo(o.w-4,yy+eachH-8);ctx.moveTo(o.w-4,yy+4);ctx.lineTo(4,yy+eachH-8);ctx.stroke();
        }break;
      }
      case 'pipe':ctx.fillStyle='#6d2f29';roundRect(ctx,0,-o.h,o.w,o.h,16);ctx.fill();ctx.fillStyle='#d5b375';ctx.fillRect(o.w*.14,-o.h,o.w*.12,o.h);ctx.fillRect(o.w*.68,-o.h,o.w*.12,o.h);break;
      case 'barrels':for(let i=0;i<2;i++){ctx.fillStyle='#7c3027';ctx.beginPath();ctx.ellipse(25+i*35,-o.h*.48,26,o.h*.48,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#c08d4c';ctx.lineWidth=4;ctx.stroke();}break;
      case 'gears':for(let i=0;i<3;i++){const gx=18+i*25,gy=-25-(i%2)*14,r=19+(i%2)*5;ctx.fillStyle='#665c4c';ctx.beginPath();ctx.arc(gx,gy,r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#2b241d';ctx.beginPath();ctx.arc(gx,gy,r*.36,0,Math.PI*2);ctx.fill();}break;
      case 'beam':ctx.fillStyle='#48423b';ctx.fillRect(0,-o.h,o.w,o.h);ctx.fillStyle='#8d6b43';for(let i=10;i<o.w;i+=28){ctx.beginPath();ctx.arc(i,-o.h*.5,4,0,Math.PI*2);ctx.fill();}break;
      case 'cart':ctx.fillStyle='#55483a';ctx.fillRect(4,-o.h,o.w-8,o.h*.66);ctx.strokeStyle='#b07b41';ctx.lineWidth=4;ctx.strokeRect(6,-o.h+2,o.w-12,o.h*.6);ctx.fillStyle='#26211c';ctx.beginPath();ctx.arc(24,-8,14,0,Math.PI*2);ctx.arc(o.w-24,-8,14,0,Math.PI*2);ctx.fill();break;
      case 'vent':ctx.fillStyle='#7d4a2e';ctx.fillRect(10,-o.h,o.w-20,o.h);ctx.fillStyle='#b5703e';ctx.fillRect(0,-o.h,o.w,14);ctx.fillStyle='rgba(220,220,200,.22)';for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(o.w*.5,-o.h-14-i*12,10+i*5,0,Math.PI*2);ctx.fill();}break;
    }
    ctx.restore();
  }
  function roundRect(c,x,y,w,h,r){
    r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();
  }

  function drawOrangie(x,baseY,mode='slide'){
    const airborne=state.y<-.5;
    const launch=state.launchSquash>0?state.launchSquash/.12:0;
    const land=state.landSquash>0?state.landSquash/.15:0;
    let squash=Math.max(launch,land);
    let sx=1+0.20*squash, sy=1-0.34*squash;
    if(airborne && state.jumpAge>.07){sx=.95;sy=1.08;}
    if(state.phase==='crashed'){sx=1;sy=1;}
    let rot=0;
    // During the intro we fake a full push without needing a bespoke animation sheet:
    // Orangie starts almost upright, then tips forward around his belly/ground contact point.
    if(mode==='introPush'){
      const fall=clamp((state.introT-.43)/.66,0,1);
      rot=-1.30 + easeOutCubic(fall)*1.30;
    }
    if(state.phase==='crashed') rot=state.crashSpin*state.crashT;
    ctx.save();ctx.translate(x,baseY);ctx.rotate(rot);ctx.scale(sx,sy);

    // Belly/hoodie silhouette — intentionally placeholder, but recognizable: curly hair, black glasses,
    // black hoodie, jeans, sneakers, broad belly.
    const bodyY=-58;
    ctx.fillStyle='#1d1c1d';ctx.beginPath();ctx.ellipse(0,bodyY,69,42,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#262427';ctx.beginPath();ctx.ellipse(-38,bodyY-12,24,31,-.25,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.ellipse(42,bodyY-10,24,31,.25,0,Math.PI*2);ctx.fill();
    // legs trailing
    ctx.fillStyle='#273039';ctx.save();ctx.translate(-48,-38);ctx.rotate(.11);ctx.fillRect(-4,-5,68,22);ctx.restore();ctx.save();ctx.translate(-43,-20);ctx.rotate(.07);ctx.fillRect(0,-5,68,21);ctx.restore();
    // shoes
    ctx.fillStyle='#4b4540';ctx.beginPath();ctx.ellipse(26,-12,23,10,.05,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(30,5,23,10,.05,0,Math.PI*2);ctx.fill();
    // head
    ctx.fillStyle='#b77b5d';ctx.beginPath();ctx.ellipse(48,-91,31,30,.02,0,Math.PI*2);ctx.fill();
    // curly hair blobs
    ctx.fillStyle='#6e412d';for(let i=0;i<9;i++){const a=i/9*Math.PI*1.45+2.9;ctx.beginPath();ctx.arc(48+Math.cos(a)*29,-101+Math.sin(a)*17,9+(i%3),0,Math.PI*2);ctx.fill();}
    // glasses
    ctx.strokeStyle='#151416';ctx.lineWidth=5;ctx.strokeRect(29,-103,23,17);ctx.strokeRect(56,-103,23,17);ctx.beginPath();ctx.moveTo(52,-95);ctx.lineTo(57,-95);ctx.stroke();
    // nose/mouth
    ctx.strokeStyle='#704737';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(55,-86);ctx.lineTo(59,-81);ctx.stroke();ctx.beginPath();ctx.moveTo(46,-75);ctx.lineTo(67,-75);ctx.stroke();
    // front arm, wooden hand
    ctx.strokeStyle='#242225';ctx.lineWidth=16;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(5,-69);ctx.lineTo(-44,-92);ctx.stroke();ctx.fillStyle='#b77b5d';ctx.beginPath();ctx.arc(-51,-95,10,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }

  function introPushAmount(){
    // Founder lunges quickly, holds contact for a beat, then settles back slightly.
    const inP=easeOutCubic(clamp((state.introT-.22)/.25,0,1));
    const outP=easeOutCubic(clamp((state.introT-.72)/.34,0,1));
    return inP*(1-.30*outP);
  }

  function drawFounderIntro(W,H,orangieX){
    if(!founderImg.complete||!founderImg.naturalWidth) return;
    const h=Math.min(H*.64,270); const w=h*(founderImg.naturalWidth/founderImg.naturalHeight);
    const baseX=Math.max(w*.52+6,orangieX-105);
    const shove=introPushAmount();
    const x=baseX+shove*28;
    const floor=groundY(x)-2;
    ctx.save();
    // Lean the whole Founder into the shove so the static sprite still reads as an action.
    ctx.translate(x,floor);
    ctx.rotate(-.08*shove);
    ctx.drawImage(founderImg,-w/2,-h,w,h);

    // Temporary push-arm overlay for the prototype. This makes physical contact obvious
    // without requiring a dedicated Founder animation yet.
    if(shove>.18){
      const shoulderX=w*.18, shoulderY=-h*.53;
      const targetX=(orangieX-x)-43, targetY=-94;
      ctx.strokeStyle='#432034';ctx.lineWidth=Math.max(14,h*.068);ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(shoulderX,shoulderY);ctx.lineTo(targetX,targetY);ctx.stroke();
      ctx.strokeStyle='#6f3457';ctx.lineWidth=Math.max(8,h*.038);ctx.beginPath();ctx.moveTo(shoulderX,shoulderY-1);ctx.lineTo(targetX,targetY-1);ctx.stroke();
      ctx.fillStyle='#986044';ctx.beginPath();ctx.arc(targetX+3,targetY,Math.max(8,h*.04),0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }

  function drawPushImpact(x,y){
    const hit=clamp(1-Math.abs(state.introT-.56)/.15,0,1);
    if(hit<=0)return;
    ctx.save();ctx.translate(x,y);ctx.globalAlpha=hit;ctx.strokeStyle='#f0c56c';ctx.lineWidth=3;ctx.lineCap='round';
    for(let i=0;i<5;i++){const a=-1.35+i*.33;ctx.beginPath();ctx.moveTo(Math.cos(a)*16,Math.sin(a)*16);ctx.lineTo(Math.cos(a)*36,Math.sin(a)*36);ctx.stroke();}
    ctx.restore();
  }

  function drawIntro(W,H){
    const shove=introPushAmount();
    const playerX=W*PLAYER_X_RATIO;
    // Orangie begins slightly behind his normal gameplay anchor, then gets shoved into it.
    const orangieX=playerX-38 + easeOutCubic(clamp((state.introT-.38)/.52,0,1))*38;
    const y=groundY(orangieX)-5;
    drawFounderIntro(W,H,orangieX);
    drawOrangie(orangieX,y,'introPush');
    drawPushImpact(orangieX-53,y-92);

    // Small camera/ground impulse at the exact contact beat sells the shove and belly impact.
    const impact=clamp(1-Math.abs(state.introT-.58)/.12,0,1);
    if(impact>.02) state.shake=Math.max(state.shake,impact*4.5);

    const splat=clamp((state.introT-1.02)/.18,0,1);
    if(splat>0){
      ctx.save();ctx.globalAlpha=splat*(1-clamp((state.introT-1.38)/.17,0,1));ctx.fillStyle='#f4d69b';ctx.font='700 26px Oswald';ctx.textAlign='center';ctx.fillText('SPLAT',orangieX+66,y-20);ctx.restore();
    }
  }

  function drawPlaying(W,H){
    for(const o of state.obstacles){const sx=o.x-state.scrollX;if(sx>-160&&sx<W+140)drawObstacle(o);}
    for(const c of state.pickups){if(c.taken)continue;const sx=c.x-state.scrollX;if(sx<-80||sx>W+80)continue;const cy=groundY(sx)-c.yOff;drawCarrot(sx,cy,state.t*3+c.spin,.86);}
    drawOrangie(W*PLAYER_X_RATIO,playerBaseY()+state.y);
    for(const d of state.dust){ctx.save();ctx.globalAlpha=clamp(d.life/.45,0,1)*.45;ctx.fillStyle='#d2a16a';ctx.beginPath();ctx.arc(d.x,d.y,d.r,0,Math.PI*2);ctx.fill();ctx.restore();}
  }

  function draw(){
    resizeCanvas(); const W=state.viewW,H=state.viewH;
    ctx.save();
    const shakeX=state.shake?rnd(-state.shake,state.shake):0, shakeY=state.shake?rnd(-state.shake*.45,state.shake*.45):0;
    ctx.translate(shakeX,shakeY);
    drawSky(W,H);drawFactoryBack(W,H);drawSlope(W,H);
    if(state.phase==='intro') drawIntro(W,H); else if(state.phase==='idle'){
      // faint attract-state silhouette under overlay
      drawOrangie(W*.30,playerBaseY());
    } else drawPlaying(W,H);
    if(state.flashT>0){ctx.fillStyle=`rgba(244,205,104,${state.flashT/.14*.18})`;ctx.fillRect(0,0,W,H);}
    ctx.restore();
  }

  function updateHUD(){
    distanceEl.textContent=Math.floor(state.distance).toLocaleString('en-US');
    carrotsEl.textContent=state.carrots;
    const b=best();
    bestDistanceEl.textContent=(b?.distance||0).toLocaleString('en-US');
    bestCarrotsEl.textContent=b?.carrots||0;
  }

  function renderLeaderboard(){
    const b=best();
    const entries=[
      {name:'@slopeaudit',distance:1847,carrots:19},
      {name:'@shiftgremlin',distance:1462,carrots:14},
      {name:'@wasteworker',distance:1135,carrots:12},
      {name:'@bellyops',distance:884,carrots:9},
      {name:'@overtimeltd',distance:641,carrots:7}
    ];
    if(b)entries.push({name:'@YOU',distance:Number(b.distance),carrots:Number(b.carrots),you:true});
    entries.sort((a,b)=>b.distance-a.distance||b.carrots-a.carrots);
    $('leaderRows').innerHTML=entries.map((e,i)=>`<tr${e.you?' class="leaderboard-you"':''}><td>${i+1}</td><td>${e.name}${e.you?' <small>YOU</small>':''}</td><td>${e.distance.toLocaleString('en-US')}m</td><td>${e.carrots}</td></tr>`).join('');
  }

  function showScorecard(r){
    cardDistance.textContent=r.distance.toLocaleString('en-US'); cardCarrots.textContent=r.carrots;
    drawScorecard(r); scorecardBackdrop.hidden=false;
  }

  function drawScorecard(r){
    const c=cardCtx,W=1200,H=960;c.clearRect(0,0,W,H);
    const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,'#281915');g.addColorStop(.62,'#4d2f20');g.addColorStop(1,'#130b07');c.fillStyle=g;c.fillRect(0,0,W,H);
    // industrial bands
    c.globalAlpha=.32;c.fillStyle='#8d3027';for(let x=-60;x<W+100;x+=260)c.fillRect(x,0,44,650);c.globalAlpha=1;
    c.strokeStyle='#d2a45b';c.lineWidth=5;c.beginPath();c.moveTo(0,590);c.lineTo(W,760);c.stroke();
    c.fillStyle='#271a13';c.beginPath();c.moveTo(0,590);c.lineTo(W,760);c.lineTo(W,874);c.lineTo(0,874);c.closePath();c.fill();
    // tiny scorecard Orangie + carrot motif
    c.save();c.translate(330,660);c.rotate(.12);c.fillStyle='#1d1c1d';c.beginPath();c.ellipse(0,0,115,68,0,0,Math.PI*2);c.fill();c.fillStyle='#b77b5d';c.beginPath();c.arc(88,-48,48,0,Math.PI*2);c.fill();c.strokeStyle='#111';c.lineWidth=8;c.strokeRect(54,-70,37,27);c.strokeRect(98,-70,37,27);c.restore();
    c.save();c.translate(860,600);c.rotate(-.1);c.fillStyle='#e7b63c';c.beginPath();c.moveTo(-24,-28);c.lineTo(30,-18);c.lineTo(5,72);c.closePath();c.fill();c.strokeStyle='#7c9a43';c.lineWidth=12;c.beginPath();c.moveTo(0,-20);c.lineTo(-30,-65);c.moveTo(8,-20);c.lineTo(22,-68);c.stroke();c.restore();
    const top=c.createLinearGradient(0,0,0,240);top.addColorStop(0,'#100805ed');top.addColorStop(1,'#10080500');c.fillStyle=top;c.fillRect(0,0,W,260);
    const bottom=c.createLinearGradient(0,540,0,874);bottom.addColorStop(0,'#10080500');bottom.addColorStop(.6,'#100805b8');bottom.addColorStop(1,'#100805f5');c.fillStyle=bottom;c.fillRect(0,540,W,334);
    c.textAlign='center';c.shadowColor='#100805';c.shadowBlur=16;c.shadowOffsetY=3;c.fillStyle='#fff1ce';c.font='700 96px Oswald';c.fillText('BELLY BOUNCE',600,125);
    c.fillStyle='#edc879';c.font='600 27px "IBM Plex Mono"';c.fillText(r.newBest?'NEW EMPLOYEE RECORD':'DISTANCE CLEARED',600,685);
    const dist=`${r.distance.toLocaleString('en-US')}m`;c.fillStyle='#fff1ce';c.font='700 150px Oswald';c.fillText(dist,600,830);
    c.shadowBlur=0;c.shadowOffsetY=0;c.fillStyle='#d8ae5c';c.fillRect(0,874,W,4);c.fillStyle='#f6ecd4';c.fillRect(0,878,W,82);c.fillStyle='#7d211c';c.font='700 28px Oswald';c.fillText(`${r.carrots} GOLDEN CARROTS  ·  ${r.time.toFixed(1)}s  ·  PLAY @ CUCKS.MONEY`,600,931);
  }

  function downloadCard(){
    try{const a=document.createElement('a');a.download=`belly-bounce-${Math.floor(state.distance)}m.png`;a.href=scorecard.toDataURL('image/png');a.click();}catch{alert('Image export is available when the game is served over HTTP/HTTPS.');}
  }
  function shareX(){
    const b=best();if(!b)return;
    const text=`I survived ${b.distance.toLocaleString('en-US')}m down the Cuck Factory waste slope and recovered ${b.carrots} Golden Carrots in BELLY BOUNCE.\n\nGet to work: cucks.money`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`,'_blank','noopener,noreferrer');
  }

  function loop(ts){
    const dt=Math.min(.034,(ts-state.lastTs)/1000||0);state.lastTs=ts;update(dt);draw();requestAnimationFrame(loop);
  }

  function togglePause(){
    if(state.phase!=='playing')return;state.paused=!state.paused;pauseBtn.textContent=state.paused?'▶':'Ⅱ';statusCaption.textContent=state.paused?'PAUSED':'SLIDING';if(state.paused)releaseBounce();
  }

  ['contextmenu','selectstart'].forEach(type=>gameShell.addEventListener(type,e=>e.preventDefault()));
  addEventListener('keydown',e=>{
    if(e.code==='Space'){
      e.preventDefault();
      if(state.phase==='idle'&&!e.repeat){start();return;}
      if(!e.repeat)pressBounce();
    }
  });
  addEventListener('keyup',e=>{if(e.code==='Space'){e.preventDefault();releaseBounce();}});
  addEventListener('blur',releaseBounce);

  [bounceBtn,canvas].forEach(el=>{
    el.addEventListener('pointerdown',e=>{e.preventDefault();el.setPointerCapture?.(e.pointerId);pressBounce();});
    el.addEventListener('pointerup',e=>{e.preventDefault();releaseBounce();});
    el.addEventListener('pointercancel',releaseBounce);el.addEventListener('lostpointercapture',releaseBounce);
    el.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});el.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});el.addEventListener('touchend',e=>e.preventDefault(),{passive:false});
  });
  addEventListener('pointerup',releaseBounce);

  $('startBtn').addEventListener('click',start);
  pauseBtn.addEventListener('click',togglePause);
  $('playAgainBtn').addEventListener('click',()=>{scorecardBackdrop.hidden=true;start();});
  $('closeCardBtn').addEventListener('click',()=>{scorecardBackdrop.hidden=true;resetWorld();state.phase='idle';overlay.hidden=false;statusCaption.textContent='READY';});
  $('downloadBtn').addEventListener('click',downloadCard);
  $('shareBtn').addEventListener('click',shareX);

  addEventListener('resize',resizeCanvas);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.phase==='playing'){state.paused=true;pauseBtn.textContent='▶';statusCaption.textContent='PAUSED';releaseBounce();}});

  resetWorld();state.phase='idle';overlay.hidden=false;statusCaption.textContent='READY';renderLeaderboard();resizeCanvas();requestAnimationFrame(ts=>{state.lastTs=ts;loop(ts);});
})();
