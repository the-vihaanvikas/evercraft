import puppeteer from 'puppeteer';
const b = await puppeteer.launch({headless:'new',protocolTimeout:240000,args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--disable-dev-shm-usage']});
const p = await b.newPage();
await p.goto('http://127.0.0.1:8080/',{waitUntil:'networkidle2'});
await p.evaluate(()=>window.__EVERCRAFT.begin({slot:3,name:'A',seed:'audit',mode:'creative',load:false}));
await p.waitForFunction(()=>document.querySelector('#loading').classList.contains('hidden'),{timeout:90000});
const out = await p.evaluate(async ()=>{
  const THREE = await import('/vendor/three.module.js');
  const {Entity,SPECIES} = await import('/src/entities.js');
  const rep = {};
  const mk = (kind)=>{ const e=new Entity(kind,0,0,0); e.yaw=0; e._vyaw=0; const m=e.buildMesh();
    m.position.set(0,0,0); return {e,m}; };
  // world-space tip of a limb pivot, relative to the model root
  const tip=(pivot,root)=>{ const len=pivot.userData.len||0.3;
    root.updateWorldMatrix(true,true);
    return pivot.localToWorld(new THREE.Vector3(0,-len,0)); };

  for (const kind of Object.keys(SPECIES)) {
    const r={};
    { // CHASE: arms reach forward (-Z)
      const {e,m}=mk(kind); const ud=m.userData;
      if(ud.arms){ e.state='chase'; e.animT=0; e._animate(1/60);
        r.armRotX=+ud.arms[0].rotation.x.toFixed(3);
        r.armTipZ=+tip(ud.arms[0],m).z.toFixed(3);
        r.armForward = r.armTipZ < -0.05; }
    }
    { // GRAZE: nose dips below rest height
      const {e,m}=mk(kind); const ud=m.userData;
      if(ud.head){ const restY=ud.head.position.y;
        e.state='graze'; for(let i=0;i<150;i++){e.animT+=1/60;e._animate(1/60);}
        m.updateWorldMatrix(true,true);
        const n=ud.head.localToWorld(new THREE.Vector3(0,0,-0.45));
        r.headRotX=+ud.head.rotation.x.toFixed(3);
        r.grazeDip=+(n.y-restY).toFixed(3);
        r.headDips = n.y < restY - 0.02; }
    }
    { // WALK: legs swing, quadrupeds use diagonal pairing
      const {e,m}=mk(kind); const ud=m.userData;
      if(ud.legs&&!ud.spider){ e.state='walk'; let mn=9,mx=-9;
        for(let i=0;i<240;i++){e.animT+=1/60;e.vel.x=3;e._animate(1/60);
          const rx=ud.legs[0].rotation.x; mn=Math.min(mn,rx); mx=Math.max(mx,rx);}
        r.legSwingRad=+(mx-mn).toFixed(3); r.legsSwing=(mx-mn)>0.3;
        if(ud.legs.length>=4){
          const a=ud.legs[0].rotation.x,c=ud.legs[1].rotation.x,d=ud.legs[3].rotation.x;
          r.diagonalGait = Math.abs(a-d)<0.02 && Math.abs(a-c)>0.05; } }
    }
    { // proportions vs hitbox
      const {e,m}=mk(kind); e._animate(1/60); m.updateWorldMatrix(true,true);
      const box=new THREE.Box3().setFromObject(m);
      r.minY=+box.min.y.toFixed(3); r.maxY=+box.max.y.toFixed(3);
      r.h=SPECIES[kind].h; r.w=SPECIES[kind].w;
      r.widthX=+(box.max.x-box.min.x).toFixed(2);
      // ears/crests/outstretched arms legitimately exceed the collision box;
      // allow a modest appendage margin, but the bulk must fit.
      r.sinks=box.min.y<-0.08;
      r.tooTall=box.max.y>SPECIES[kind].h*1.55;
      r.tooWide=(box.max.x-box.min.x)>SPECIES[kind].w*1.75;
    }
    rep[kind]=r;
  }
  return rep;
});
for(const[k,v] of Object.entries(out)) console.log(k.padEnd(10), JSON.stringify(v));
await b.close();
