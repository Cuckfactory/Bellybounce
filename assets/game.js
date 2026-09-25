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
  const cardPower = $('cardPower');
  const gameShell = $('gameShell');

  const DPR_CAP = 2;
  const METERS_PER_PIXEL = 0.035;
  const GRAVITY = 2140;
  const JUMP_VY = -675;
  const HOLD_ACCEL = -1220;
  const MAX_HOLD = 0.27;
  const PLAYER_X_RATIO = 0.30;
  const INTRO_SECONDS = 2.15;
  const START_SPEED = 410;
  const CRASH_SECONDS = 1.15;
  const STORAGE_KEY = 'belly-bounce-best-v1';

  function loadImg(src){
    const img=new Image();
    img.src=src;
    return img;
  }

  const orangieSprites = {
    stand: loadImg('./assets/sprites/orangie/stand.png'),
    air: loadImg('./assets/sprites/orangie/air.png'),
    slide: [
      loadImg('./assets/sprites/orangie/slide_0.png'),
      loadImg('./assets/sprites/orangie/slide_1.png'),
      loadImg('./assets/sprites/orangie/slide_2.png'),
      loadImg('./assets/sprites/orangie/slide_3.png')
    ],
    crash: [
      loadImg('./assets/sprites/orangie/crash_0.png'),
      loadImg('./assets/sprites/orangie/crash_1.png'),
      loadImg('./assets/sprites/orangie/crash_2.png'),
      loadImg('./assets/sprites/orangie/crash_3.png')
    ]
  };

  const founderSprites = [
    loadImg('./assets/sprites/founder/founder_0.png'),
    loadImg('./assets/sprites/founder/founder_1.png'),
    loadImg('./assets/sprites/founder/founder_2.png'),
    loadImg('./assets/sprites/founder/founder_3.png'),
    loadImg('./assets/sprites/founder/founder_4.png')
  ];

  const scorecardBackground = loadImg('./assets/scorecards/belly-bounce-scorecard.png');

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
  function worldScale(){ return state.viewW < 600 ? 0.68 : 1; }
  function easeOutCubic(t){ return 1-Math.pow(1-t,3); }
  function computeCuckPower(distance, carrots, time){
    const d = Math.max(0, Math.floor(distance||0));
    const c = Math.max(0, carrots||0);
    const t = Math.max(.1, time||0);
    const efficiency = Math.round((d / t) * 6);
    return d + c * 125 + efficiency;
  }

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
    // Mobile Safari often keeps the page scrolled around the large action button.
    // Bring the actual game shell back into view when a new run begins.
    if(window.innerWidth<=600){
      requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'smooth'}));
    }
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
    const s=worldScale();
    const x=state.viewW*PLAYER_X_RATIO;
    const base=playerBaseY()+state.y;
    // Belly-forward, forgiving collision box: visual character is bigger than the lethal core.
    return {x:x-49*s,y:base-47*s,w:98*s,h:41*s};
  }
  function obstacleHitbox(o){
    const s=worldScale();
    const sx=o.x-state.scrollX;
    const y=groundY(sx);
    const pad=(o.kind==='beam'?7:5)*s;
    return {x:sx+pad,y:y-o.h*s+pad,w:o.w*s-pad*2,h:o.h*s-pad};
  }
  function overlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}

  function crash(){
    if(state.phase!=='playing') return;
    state.phase='crashed'; state.crashT=0; state.pressing=false; bounceBtn.classList.remove('active');
    state.vy=0; state.y=0; state.crashSpin=0; state.shake=10;
    statusCaption.textContent='TERMINATED';
    dangerEl.textContent='SHIFT TERMINATED'; dangerEl.classList.add('show');
    const result={distance:Math.floor(state.distance),carrots:state.carrots,time:+state.t.toFixed(2)};
    result.power = computeCuckPower(result.distance, result.carrots, result.time);
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
        state.phase='playing'; state.t=0; state.y=0; state.vy=0; state.grounded=true;
        statusCaption.textContent='SLIDING';
        state.landSquash=.10;
        spawnDust(state.viewW*PLAYER_X_RATIO,playerBaseY()+3,9);
      }
      return;
    }
    if(state.phase==='playing'){updatePlaying(dt);return;}
    if(state.phase==='crashed'){
      state.crashT+=dt;
      state.shake=Math.max(0,state.shake-18*dt);
      if(state.crashT>=CRASH_SECONDS && state.lastResult){
        dangerEl.classList.remove('show');
        showScorecard(state.lastResult);
        state.lastResult=null;
      }
    }
  }

  function drawSky(W,H){
    const g=ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#0b1522');
    g.addColorStop(.36,'#24384b');
    g.addColorStop(.72,'#6b4a3a');
    g.addColorStop(1,'#261712');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

    // cold glow near the horizon for an outdoor snowy setting.
    const glow=ctx.createRadialGradient(W*.78,H*.16,18,W*.78,H*.16,W*.38);
    glow.addColorStop(0,'rgba(253,222,177,.55)');
    glow.addColorStop(.45,'rgba(240,187,118,.18)');
    glow.addColorStop(1,'rgba(240,187,118,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,W,H*.52);

    // layered mountain silhouettes.
    ctx.fillStyle='rgba(19,28,39,.78)';
    ctx.beginPath();
    ctx.moveTo(0,H*.34);
    for(let x=0;x<=W+90;x+=90){
      const peak=H*(.23 + ((x/90)%2===0?.06:.12));
      ctx.lineTo(x,peak);
    }
    ctx.lineTo(W,H*.46);ctx.lineTo(W,0);ctx.lineTo(0,0);ctx.closePath();ctx.fill();

    ctx.fillStyle='rgba(95,117,136,.38)';
    ctx.beginPath();
    ctx.moveTo(0,H*.37);
    for(let x=0;x<=W+120;x+=120){
      const peak=H*(.29 + ((x/120)%3===0?.05:.1));
      ctx.lineTo(x,peak);
    }
    ctx.lineTo(W,H*.50);ctx.lineTo(0,H*.50);ctx.closePath();ctx.fill();

    // drifting haze / snowfall.
    ctx.fillStyle='rgba(236,243,250,.05)';ctx.fillRect(0,H*.24,W,H*.18);
    for(let i=0;i<24;i++){
      const sx=((i*97)+(state.scrollX*.12))%(W+40)-20;
      const sy=(i*37)%(H*.46);
      ctx.fillStyle=i%3===0?'rgba(255,255,255,.26)':'rgba(214,228,240,.16)';
      ctx.beginPath();ctx.arc(sx,sy, i%4===0?2.2:1.2,0,Math.PI*2);ctx.fill();
    }
  }

  function drawFactoryBack(W,H){
    const px=-(state.scrollX*.10)%520;
    ctx.save();ctx.globalAlpha=.92;

    // Exterior factory blocks sitting against the mountain.
    for(let i=-1;i<5;i++){
      const x=px+i*520;
      // back mass
      ctx.fillStyle='#181513';ctx.fillRect(x,H*.20,350,H*.24);
      ctx.fillStyle='#251d19';ctx.fillRect(x+24,H*.24,300,H*.17);
      ctx.fillStyle='#140f0d';
      for(let w=0;w<4;w++)ctx.fillRect(x+46+w*62,H*.28,32,44);

      // roof snow / frost edge
      ctx.fillStyle='rgba(235,239,243,.8)';ctx.fillRect(x+18,H*.20,314,7);
      ctx.fillStyle='rgba(222,228,236,.35)';ctx.fillRect(x+28,H*.24,280,3);

      // chimney / stack
      ctx.fillStyle='#60392d';ctx.fillRect(x+332,H*.11,34,H*.33);
      ctx.fillStyle='#d0a968';ctx.fillRect(x+338,H*.11,5,H*.33);
      ctx.fillStyle='#261916';ctx.fillRect(x+347,H*.11,9,H*.33);
      ctx.fillStyle='rgba(220,220,215,.15)';
      for(let p=0;p<3;p++){ctx.beginPath();ctx.arc(x+349,H*.10-p*12,10+p*4,0,Math.PI*2);ctx.fill();}

      // striped industrial post / silo
      ctx.fillStyle='#7f3128';ctx.fillRect(x+392,H*.18,28,H*.28);
      ctx.fillStyle='#eadab2';for(let k=0;k<4;k++)ctx.fillRect(x+392,H*.18+k*44,28,18);

    }

    ctx.restore();
  }

  function drawSlope(W,H){
    const leftY=groundY(0),rightY=groundY(W);
    ctx.save();
    ctx.beginPath();ctx.moveTo(0,leftY);ctx.lineTo(W,rightY);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();
    const dirt=ctx.createLinearGradient(0,leftY,0,H);
    dirt.addColorStop(0,'#6f4c37');
    dirt.addColorStop(.18,'#4f3527');
    dirt.addColorStop(.58,'#2f2118');
    dirt.addColorStop(1,'#130d0a');
    ctx.fillStyle=dirt;ctx.fill();

    // snow layer riding on top of the waste slope.
    ctx.strokeStyle='#efe6d9';ctx.lineWidth=8;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,leftY-1);ctx.lineTo(W,rightY-1);ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,.45)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,leftY-6);ctx.lineTo(W,rightY-6);ctx.stroke();

    // packed snow shelf
    ctx.beginPath();
    ctx.moveTo(0,leftY);
    for(let x=0;x<=W;x+=24){
      ctx.lineTo(x,groundY(x)+3+Math.sin((x+state.scrollX*.03)*.06)*2.5);
    }
    for(let x=W;x>=0;x-=24){
      ctx.lineTo(x,groundY(x)+24+Math.sin((x+state.scrollX*.02)*.05)*3.5);
    }
    ctx.closePath();
    const snow=ctx.createLinearGradient(0,leftY,0,leftY+52);snow.addColorStop(0,'rgba(241,238,233,.88)');snow.addColorStop(1,'rgba(197,183,160,.14)');ctx.fillStyle=snow;ctx.fill();

    // waste streaks / scrap scars through the snow.
    ctx.strokeStyle='rgba(195,137,72,.24)';ctx.lineWidth=2;
    const off=-(state.scrollX*.78)%130;
    for(let x=off-130;x<W+160;x+=130){
      const y=groundY(x)+rndVisual(x)*34+26;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+72,y+16);ctx.stroke();
    }

    // scattered rocks and scrap under the snow.
    for(let i=0;i<20;i++){
      const x=((i*197 + (state.scrollX*.55))%(W+140))-70;
      const y=groundY(x)+28+(i%5)*18;
      ctx.fillStyle=i%3===0?'#8a5a33':'#2c211a';ctx.beginPath();ctx.arc(x,y,3+(i%4),0,Math.PI*2);ctx.fill();
      if(i%2===0){ctx.fillStyle='rgba(241,238,233,.5)';ctx.beginPath();ctx.arc(x+3,y-5,2+(i%3),0,Math.PI*2);ctx.fill();}
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
    const x=o.x-state.scrollX,y=groundY(x),s=worldScale();
    ctx.save();ctx.translate(x,y);ctx.scale(s,s);
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

  function imageReady(img){ return img && img.complete && img.naturalWidth>0; }

  function drawOrangieSprite(img,x,baseY,scale=1,rotation=0,sx=1,sy=1,alpha=1){
    if(!imageReady(img)) return;
    const s=scale*worldScale();
    ctx.save();
    ctx.translate(x,baseY);
    ctx.rotate(rotation);
    ctx.scale(s*sx,s*sy);
    ctx.globalAlpha=alpha;
    // Orangie frames use a shared 384x288 canvas with a ground anchor around (192,246).
    ctx.drawImage(img,-192,-246,384,288);
    ctx.restore();
  }

  function drawFounderSprite(img,x,baseY,scale=1,rotation=0){
    if(!imageReady(img)) return;
    const s=scale*worldScale();
    ctx.save();
    ctx.translate(x,baseY);
    ctx.rotate(rotation);
    ctx.scale(s,s);
    // Founder frames use a 512x384 canvas with ground anchor (256,350).
    ctx.drawImage(img,-256,-350,512,384);
    ctx.restore();
  }

  function currentSlideSprite(){
    return orangieSprites.slide[Math.floor(state.t*10)%orangieSprites.slide.length];
  }

  function drawOrangie(x,baseY,mode='play'){
    const baseScale=.52;

    if(mode==='stand'){
      drawOrangieSprite(orangieSprites.stand,x,baseY,baseScale);
      return;
    }
    if(mode==='air'){
      drawOrangieSprite(orangieSprites.air,x,baseY,baseScale);
      return;
    }

    if(state.phase==='crashed'){
      let idx=0;
      if(state.crashT>.16) idx=1;
      if(state.crashT>.38) idx=2;
      if(state.crashT>.72) idx=3;
      drawOrangieSprite(orangieSprites.crash[idx],x,baseY+4,baseScale);
      return;
    }

    if(!state.grounded){
      // A tiny compressed launch beat, then the clean belly-in-the-air pose.
      if(state.jumpAge<.085){
        const k=1-state.jumpAge/.085;
        drawOrangieSprite(currentSlideSprite(),x,baseY,baseScale,0,1+.18*k,1-.28*k);
      }else{
        const rot=clamp(state.vy/1800,-.055,.075);
        drawOrangieSprite(orangieSprites.air,x,baseY,baseScale,rot);
      }
      return;
    }

    if(state.landSquash>0){
      const k=state.landSquash/.15;
      drawOrangieSprite(currentSlideSprite(),x,baseY+2,baseScale,0,1+.22*k,1-.30*k);
      return;
    }

    drawOrangieSprite(currentSlideSprite(),x,baseY,baseScale);
  }

  function introPlatformY(H){ return state.viewW<600 ? H*.36 : H*.38; }

  function drawIntroPlatform(W,H){
    const y=introPlatformY(H);
    const orangieStart=W<600?W*.38:W*.24;
    const right=orangieStart+(W<600?38:60);
    const left=Math.max(8,W<600?orangieStart-118:35);

    // Industrial loading platform made from stacked factory crates + steel top.
    ctx.save();
    ctx.fillStyle='#302720';
    ctx.fillRect(left,y,right-left,16);
    ctx.fillStyle='#9f7642';
    ctx.fillRect(left,y,right-left,4);
    ctx.fillStyle='#1f1a17';
    for(let sx=left+12;sx<right-14;sx+=26)ctx.fillRect(sx,y+5,15,3);
    ctx.strokeStyle='#d0a45e';
    ctx.lineWidth=2;
    ctx.strokeRect(left+2,y+2,right-left-4,12);
    // caution stripe lip
    for(let sx=left+8;sx<right-12;sx+=18){ctx.fillStyle=sx%36===0?'#d6b15c':'#4b3424';ctx.fillRect(sx,y+10,10,4);}    

    const crateW=W<600?38:54, crateH=W<600?30:38;
    for(let x=left+8;x<right-12;x+=crateW+4){
      for(let row=0;row<2;row++){
        const cy=y+16+row*crateH;
        ctx.fillStyle=row?'#543721':'#644228';
        ctx.fillRect(x,cy,crateW,crateH-3);
        ctx.strokeStyle='#a67540';
        ctx.strokeRect(x+2,cy+2,crateW-4,crateH-7);
        ctx.beginPath();ctx.moveTo(x+4,cy+4);ctx.lineTo(x+crateW-4,cy+crateH-8);
        ctx.moveTo(x+crateW-4,cy+4);ctx.lineTo(x+4,cy+crateH-8);ctx.stroke();
      }
    }
    ctx.fillStyle='#211b17';
    ctx.fillRect(left,y+16,right-left,5);
    ctx.restore();
    return {y,left,right};
  }

  function founderIntroFrame(){
    const t=state.introT;
    if(t<.46) return 0;
    if(t<.62) return 1;
    if(t<.78) return 2;
    if(t<.94) return 3;
    return 4;
  }

  function drawPushImpact(x,y){
    const hit=clamp(1-Math.abs(state.introT-.94)/.12,0,1);
    if(hit<=0)return;
    ctx.save();ctx.translate(x,y);ctx.globalAlpha=hit;ctx.strokeStyle='#f0c56c';ctx.lineWidth=3;ctx.lineCap='round';
    for(let i=0;i<5;i++){const a=-1.2+i*.3;ctx.beginPath();ctx.moveTo(Math.cos(a)*12,Math.sin(a)*12);ctx.lineTo(Math.cos(a)*29,Math.sin(a)*29);ctx.stroke();}
    ctx.restore();
  }

  function drawIntro(W,H){
    const platform=drawIntroPlatform(W,H);
    const startX=W<600?W*.38:W*.24;
    const founderX=W<600?startX-34:startX-38;
    const playerX=W*PLAYER_X_RATIO;
    const edgeX=platform.right-10;
    const t=state.introT;

    // Founder is intentionally taller than Orangie.
    const founderFrame=founderSprites[founderIntroFrame()];
    drawFounderSprite(founderFrame,founderX,platform.y,W<600?0.34:0.42);

    if(t<.92){
      const p=clamp((t-.48)/.44,0,1);
      const x=startX+easeOutCubic(p)*(W<600?22:28);
      const rot=.18*easeOutCubic(p);
      drawOrangieSprite(orangieSprites.stand,x,platform.y,W<600?.44:.52,rot);
      drawPushImpact(x-16,platform.y-78);
      if(p>.6) state.shake=Math.max(state.shake,(p-.6)*3);
      return;
    }

    if(t<1.22){
      const p=clamp((t-.92)/.30,0,1);
      const introPush=W<600?22:28;
      const x=startX+introPush+(edgeX-startX-8)*easeOutCubic(p);
      const rot=.18+1.05*easeOutCubic(p);
      drawOrangieSprite(orangieSprites.stand,x,platform.y,W<600?.44:.52,rot);
      return;
    }

    if(t<1.82){
      const p=clamp((t-1.22)/.60,0,1);
      const x=edgeX+14+(playerX-edgeX-14)*p;
      const targetY=playerBaseY();
      const y=platform.y+18+(targetY-platform.y-18)*(p*p);
      drawOrangieSprite(orangieSprites.air,x,y,W<600?.44:.52,.04+.08*p);
      return;
    }

    const p=clamp((t-1.82)/.33,0,1);
    const squash=Math.sin(p*Math.PI);
    drawOrangieSprite(orangieSprites.slide[0],playerX,playerBaseY()+2,W<600?.44:.52,0,1+.25*squash,1-.34*squash);
    if(p<.35){
      state.shake=Math.max(state.shake,(1-p/.35)*5);
    }
  }

  function drawPlaying(W,H){
    for(const o of state.obstacles){const sx=o.x-state.scrollX;if(sx>-160&&sx<W+140)drawObstacle(o);}
    for(const c of state.pickups){if(c.taken)continue;const sx=c.x-state.scrollX;if(sx<-80||sx>W+80)continue;const cy=groundY(sx)-c.yOff*worldScale();drawCarrot(sx,cy,state.t*3+c.spin,.86*worldScale());}
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
      drawOrangie(W*.30,playerBaseY(),'stand');
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
    cardDistance.textContent=r.distance.toLocaleString('en-US');
    cardCarrots.textContent=r.carrots;
    cardPower.textContent=(r.power || computeCuckPower(r.distance, r.carrots, r.time)).toLocaleString('en-US');
    drawScorecard(r); scorecardBackdrop.hidden=false;
  }

  function drawScorecard(r){
    const c=cardCtx,W=1200,H=960;c.clearRect(0,0,W,H);
    const power = r.power || computeCuckPower(r.distance, r.carrots, r.time);

    // fallback base
    const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,'#281915');g.addColorStop(.62,'#4d2f20');g.addColorStop(1,'#130b07');c.fillStyle=g;c.fillRect(0,0,W,H);

    // hero scorecard image supplied by the project
    if(imageReady(scorecardBackground)){
      const img=scorecardBackground;
      const cover=Math.max(W/img.naturalWidth,620/img.naturalHeight);
      const dw=img.naturalWidth*cover, dh=img.naturalHeight*cover;
      const dx=(W-dw)/2, dy=0;
      c.drawImage(img,dx,dy,dw,dh);
    }

    // legibility overlays, deliberately avoiding the characters
    const top=c.createLinearGradient(0,0,0,240);top.addColorStop(0,'rgba(10,6,4,.38)');top.addColorStop(1,'rgba(10,6,4,0)');c.fillStyle=top;c.fillRect(0,0,W,240);
    const bottom=c.createLinearGradient(0,500,0,H);bottom.addColorStop(0,'rgba(10,6,4,0)');bottom.addColorStop(.34,'rgba(10,6,4,.72)');bottom.addColorStop(1,'rgba(10,6,4,.98)');c.fillStyle=bottom;c.fillRect(0,500,W,H-500);

    // compact title plaque placed above the characters, more to the right so faces stay visible
    c.fillStyle='rgba(14,8,6,.72)';
    c.strokeStyle='rgba(210,164,91,.92)';
    c.lineWidth=3;
    roundRect(c,380,44,405,92,20); c.fill(); c.stroke();

    c.textAlign='left';
    c.shadowColor='#100805';c.shadowBlur=16;c.shadowOffsetY=3;
    c.fillStyle='#fff1ce';c.font='700 60px Oswald';c.fillText('BELLY BOUNCE',410,101);
    c.fillStyle='#edc879';c.font='600 20px "IBM Plex Mono"';c.fillText(r.newBest?'NEW EMPLOYEE RECORD':'SHIFT REPORT',500,126);
    c.shadowBlur=0;c.shadowOffsetY=0;

    // stat panel with dedicated distance + power blocks
    c.fillStyle='rgba(20,10,7,.82)';
    c.strokeStyle='#d2a45b';c.lineWidth=4;
    roundRect(c,85,640,1030,208,28); c.fill(); c.stroke();

    c.strokeStyle='rgba(210,164,91,.4)';c.lineWidth=2;
    c.beginPath();c.moveTo(742,668);c.lineTo(742,820);c.stroke();

    c.textAlign='center';
    c.fillStyle='#cfae73';c.font='600 24px "IBM Plex Mono"';
    c.fillText('DISTANCE CLEARED',410,700);
    const dist=`${r.distance.toLocaleString('en-US')}m`;
    c.fillStyle='#fff1ce';c.font='700 112px Oswald';c.fillText(dist,410,792);

    c.fillStyle='#cfae73';c.font='600 24px "IBM Plex Mono"';
    c.fillText('CUCK POWER',925,700);
    c.fillStyle='#fff1ce';c.font='700 88px Oswald';c.fillText(power.toLocaleString('en-US'),925,784);
    c.fillStyle='#d6b15c';c.font='600 16px "IBM Plex Mono"';
    c.fillText('distance + carrots × 125 + efficiency',925,820);

    c.fillStyle='#d8ae5c';c.fillRect(120,878,960,4);
    c.fillStyle='#f6ecd4';c.fillRect(0,884,W,76);
    c.fillStyle='#7d211c';c.font='700 22px Oswald';
    c.fillText(`${r.carrots} GOLDEN CARROTS  ·  ${r.time.toFixed(1)}s  ·  ${power.toLocaleString('en-US')} CUCK POWER  ·  PLAY @ CUCKS.MONEY`,600,932);
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
