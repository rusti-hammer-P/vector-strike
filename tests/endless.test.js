import assert from 'node:assert/strict';
import {
  CONSTANTS as C, ENDLESS_CONFIG as E, ENDLESS_FORMS as FORMS, TWO_PI,
  createGameState, startEndless, stepGame, fireRailgun, triggerTacticalPing,
  recordBlip, computeDynamicLeadPrediction, selectObservedTarget, setAimFromCoords,
  retryCurrentRound, returnToTitle, initRound, buildEndlessWavePlan as plan,
  evaluateEndlessPosition as pos, endlessMotion, shortestAngleDiff
} from '../src/engine.js';
import { getRadarBlipColor, fitRadarLabel } from '../src/renderer.js';

let count=0;
const test=(name,fn)=>{fn();console.log(`PASS EW-${++count}: ${name}`);};
const advance=(g,s,h=0.01)=>{for(let t=0;t<s-1e-9;t+=h)stepGame(g,Math.min(h,s-t));};
function start(w=1,angle=0) {
  const g=startEndless(createGameState(),angle,true);
  if(w>1) {
    g.endless.wave=w-1;g.state='WAVE_REST';g.endless.restRemaining=0.01;
    advance(g,0.01);g.stateTimer=E.INPUT_GUARD;
  }
  return g;
}
function fixture(g, points) {
  const proto=g.targets[0];
  g.targets=points.map(([x,y,decoy=false],i)=>({...proto,id:`fixture-${i}`,isDecoy:decoy,
    parentId:undefined,motionSign:undefined,x,y,r:Math.hypot(x,y),theta:Math.atan2(y,x),
    radialSpeed:0,omega:0,destroyed:false,breached:false}));
  g.endless.plan={events:[],assaultEndsAt:0};g.endless.spawned=0;
}
const tables=[
  '0:L/3.2:L/6.4:L',
  '0:C/3.2:L/6.4:C/9.6:L',
  '0:D/3.2:L/6.4:D/9.6:C',
  '0:B/3.2:L/6.4:B/9.6:C/12.8:D',
  '0:S/3.2:L/6.4:S/9.6:C/12.8:D/12.8:L',
  '0:Q/5.2:L/8.4:C/11.6:D/14.8:B/18:S',
  '0:M/0:F/5.2:L/8.4:C/11.6:D/14.8:B/18:S',
  '0:Q/2:C/5.2:L/8.4:D/11.6:B/14.8:S/18:C',
  '0:P/4:L/7.2:Q/9.2:C/12.4:D/15.6:B/18.8:S',
  '0:H/4:L/7.2:Q/9.2:S/12.4:C/15.6:M/15.6:F',
  '0:Q/2:C/5.2:P/8.4:S/11.6:M/11.6:F/16:D/16:B',
  '0:V/4:L/7.2:Q/9.2:C/12.4:H/15.6:M/15.6:F/20:P'
];
test('all 12 approved scores, slot totals, CLEANUP tail, deterministic bearings and high-wave cycle',()=>{
  for(let w=1;w<=120;w++) {
    const p=plan(w),base=w<=12?w:10+(w-13)%3;
    assert.equal(p.events.map(e=>`${e.at}:${e.kind}`).join('/'),tables[base-1]);
    assert.equal(E.enemies(w),p.events.length);assert.ok(p.events.length<=8);
    assert.equal(p.assaultEndsAt,p.events.at(-1).at+1.6);assert.ok(Object.isFrozen(p.events));
    let prev=null;
    for(let i=0;i<p.events.length;i++) {
      const e=p.events[i];
      if(e.kind==='F'){assert.equal(p.events[e.parentIndex].kind,'M');continue;}
      if(prev) {
        const diff=Math.abs(shortestAngleDiff(prev.bearing,e.bearing));
        assert.ok(diff>=Math.PI/2-1e-9);
        if(prev.at===e.at)assert.ok(Math.abs(diff-Math.PI)<1e-9);
      }
      prev=e;
    }
    if(w>12) {
      const rotation=(1+Math.floor((w-13)/3))*Math.PI/2;
      p.events.forEach((e,i)=>assert.ok(Math.abs(e.bearing-plan(base).events[i].bearing-rotation)<1e-8));
    }
  }
});
test('actual spawn times and counts independent of surviving/removed enemies, 30/60/120Hz',()=>{
  let cases=0,maxError=0,maxLive=0,maxHistory=0;
  for(const w of [...Array.from({length:12},(_,i)=>i+1),13,14,15,16,30,100,10000])
    for(const hz of [30,60,120])for(const erase of [false,true]) {
    const g=start(w,0.3);g.endless.hp=1000;
    const seen=new Map(g.targets.map(t=>[t.id,t.spawnedAt-g.endless.waveStartedAt]));
    for(let n=0;n<40*hz && g.state!=='WAVE_REST';n++) {
      if(erase)g.targets=[];
      stepGame(g,1/hz);
      for(const t of g.targets)seen.set(t.id,t.spawnedAt-g.endless.waveStartedAt);
      maxLive=Math.max(maxLive,g.targets.length);maxHistory=Math.max(maxHistory,g.allBlipsLog.length);
    }
    assert.equal(g.state,'WAVE_REST');
    assert.equal(g.endless.spawned,plan(w).events.length);
    assert.equal(seen.size,plan(w).events.length);
    [...seen.values()].forEach((at,i)=>maxError=Math.max(maxError,Math.abs(at-plan(w).events[i].at)));
    if(!erase)assert.equal(g.endless.hp,1000-plan(w).events.filter(e=>e.kind!=='F').length);
    cases++;
  }
  assert.ok(maxError<1e-8);assert.ok(maxLive<=8);assert.ok(maxHistory<=32);
  console.log({spawnCases:cases,maxError,maxLive,maxHistory});
});
test('common shape mappings, monochrome priority and label bounds',()=>{
  for(const [keys,shape] of [['LD','delta_lance'],['CV','crescent_wing'],['BP','twin_thruster'],
    ['SH','sidewinder'],['M','stealth_dreadnought'],['F','hologram_prism'],['Q','long_lance']])
    for(const k of keys)assert.equal(FORMS[k].shapeType,shape);
  for(const form of Object.values(FORMS))assert.equal(getRadarBlipColor({form}),'#00FFAA');
  assert.equal(getRadarBlipColor({isDanger:true}),'#FF2A55');
  assert.equal(getRadarBlipColor({isDecoy:true}),'#22D3EE');
  assert.equal(getRadarBlipColor({isOverdrive:true}),'#00F0FF');
  const ctx={measureText:()=>({width:100,actualBoundingBoxAscent:8,actualBoundingBoxDescent:2})};
  assert.equal(fitRadarLabel(ctx,'x',480,0,'right').x,472);
  assert.equal(fitRadarLabel(ctx,'x',-480,-360,'left').y,-344);
});
test('age paths are frame independent; P continuous with approved radial and lateral ramp',()=>{
  let maxDiff=0,maxStep=0;
  for(const k of Object.keys(FORMS)) {
    const results=[];
    for(const hz of [30,60,120]) {
      const g=start();const t=g.targets[0];
      Object.assign(t,{kind:k,initialTheta:0.73,motionSign:-1,speed:72,...pos(k,0,0.73,-1)});
      // Isolated path evaluation, without scheduling or core resolution.
      g.endless.plan={events:[],assaultEndsAt:100};g.endless.spawned=0;
      advance(g,k==='Q'?4.2:9,1/hz);results.push([t.x,t.y]);
      const expected=pos(k,k==='Q'?4.2:9,0.73,-1,72);
      assert.ok(Math.hypot(t.x-expected.x,t.y-expected.y)<0.1);
    }
    for(const p of results)maxDiff=Math.max(maxDiff,Math.hypot(p[0]-results[0][0],p[1]-results[0][1]));
    const m=endlessMotion(k,2,-1);
    const a=pos(k,2,0,-1),b=pos(k,2.00001,0,-1);
    assert.ok(Math.abs(m.radialSpeed-(a.r-b.r)/0.00001)<1e-6);
  }
  for(const boundary of [5,5.25,5.8]) {
    const a=pos('P',boundary-1e-7),b=pos('P',boundary+1e-7);
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<0.001);
  }
  assert.ok(Math.abs(endlessMotion('P',4.99).radialSpeed-22)<0.001);
  assert.ok(Math.abs(endlessMotion('P',5.26).radialSpeed-46)<0.001);
  assert.ok(Math.abs(pos('P',5.4).theta-(0.16*5.4+0.06*0.4+0.29*0.5))<1e-8);
  for(let a=4.9;a<5.9;a+=0.001) {
    const p=pos('P',a),q=pos('P',a+0.001);maxStep=Math.max(maxStep,Math.hypot(p.x-q.x,p.y-q.y));
  }
  assert.ok(maxDiff<=0.1);assert.ok(maxStep<0.2);
  console.log({agePathMaxDiffPx:maxDiff,pMaxOneMsStepPx:maxStep});
});
test('L/D waypoint speeds and common polar formulas match approved basic behaviours',()=>{
  const ltime=Math.hypot(75*Math.cos(0.42*Math.PI)-340,75*Math.sin(0.42*Math.PI))/28;
  assert.ok(Math.abs(pos('L',ltime).r-75)<1e-8);
  assert.ok(Math.abs(pos('L',ltime).theta-0.42*Math.PI)<1e-8);
  assert.ok(Math.abs(pos('L',ltime+1).r-43)<1e-8);
  const dtime=Math.hypot(190*Math.cos(0.24*Math.PI)-340,190*Math.sin(0.24*Math.PI))/38;
  assert.ok(Math.abs(pos('D',dtime).r-190)<1e-8);
  assert.ok(Math.abs(pos('D',dtime).theta-0.24*Math.PI)<1e-8);
  for(const s of [-1,1]) {
    assert.ok(Math.abs(pos('C',2,0,s).r-296)<1e-8);
    assert.ok(Math.abs(shortestAngleDiff(0,pos('C',2,0,s).theta)-s*0.44)<1e-8);
    assert.ok(Math.abs(pos('V',2).r-(290+5*Math.sin(3.6)))<1e-8);
    assert.ok(Math.abs(shortestAngleDiff(0,pos('S',4,0,s).theta)-s*0.24*3.2)<1e-8);
    assert.ok(Math.abs(shortestAngleDiff(0,pos('H',3,0,s).theta)-s*0.28*1.4)<1e-8);
    assert.ok(Math.abs(pos('B',6.4).r-(340-20*6.4-19*0.2))<1e-8);
    assert.ok(Math.abs(pos('F',3,0,s).r-(340-24*3+22*Math.sin(5.4)))<1e-8);
  }
});
test('firing never changes assigned trajectories or observed ability phase',()=>{
  for(const wave of [4,9,10,12]) {
    const a=start(wave,0.7),b=start(wave,0.7);
    fireRailgun(a,0.7+Math.PI,200);
    advance(a,7);advance(b,7);
    assert.deepEqual(a.targets.map(t=>[t.id,t.x,t.y,t.isBoosted,t.turnDir]),
      b.targets.map(t=>[t.id,t.x,t.y,t.isBoosted,t.turnDir]));
    assert.deepEqual(a.blipHistory,b.blipHistory);
  }
});
test('miss, two-second reload, flight pulse, invalid input and rest guards',()=>{
  const g=start();fireRailgun(g,Math.PI,200);assert.equal(g.endless.shots,1);
  advance(g,0.1);assert.ok(triggerTacticalPing(g));assert.equal(triggerTacticalPing(g),false);
  advance(g,1.89);const remaining=g.endless.reloadRemaining;
  assert.equal(fireRailgun(g),false);assert.equal(g.endless.reloadRemaining,remaining);
  advance(g,0.01);assert.equal(g.ammo,1);assert.equal(g.endless.hitShots,0);
  assert.ok(fireRailgun(g,Math.PI,200));
});
test('relative swept direct hit + one aim blast, multi-kill counts shots 1 / hit 1 / kills n',()=>{
  const g=start();fixture(g,[[150,0],[200,35],[260,0],[200,-35,true]]);
  fireRailgun(g,0,200);advance(g,0.36);
  assert.equal(g.endless.kills,3);assert.equal(g.endless.hitShots,1);assert.equal(g.endless.shots,1);
  assert.equal(g.endless.hp,5);assert.equal(g.bullet.blastTriggered,true);
  advance(g,0.5);assert.equal(g.endless.kills,3);
});
test('F normal observation silhouette, pulse certainty persists, parent birth and removal linkage',()=>{
  for(const outcome of ['kill','breach']) {
    const g=start(7),[m,f]=g.targets;
    assert.equal(f.parentId,m.id);assert.equal(f.spawnedAt,m.spawnedAt);
    assert.ok(Math.abs(shortestAngleDiff(m.theta,f.theta)-m.motionSign*0.65)<1e-9);
    recordBlip(g,f);assert.equal(g.blipHistory[0].isDecoyEcho,false);
    assert.equal(g.blipHistory[0].shapeType,'hologram_prism');
    triggerTacticalPing(g);advance(g,0.25);
    assert.ok(g.blipHistory.filter(b=>b.targetId===f.id).every(b=>b.isDecoyEcho));
    recordBlip(g,f);assert.equal(g.blipHistory[0].isDecoyEcho,true);
    g.endless.plan={events:[],assaultEndsAt:0};g.endless.spawned=0;
    if(outcome==='kill')fireRailgun(g,m.theta,m.r);
    else {m.motionSign=undefined;Object.assign(m,{r:30,x:30,y:0,radialSpeed:0,omega:0});}
    advance(g,0.4);
    assert.equal(g.targets.length,0);assert.equal(g.state,'WAVE_REST');
    assert.equal(g.endless.hp,outcome==='kill'?5:4);
    assert.equal(g.endless.kills,outcome==='kill'?1:0);
  }
});
test('F-only bullet removal leaves HP/hit/kill statistics unchanged and bullet continues',()=>{
  const g=start();fixture(g,[[180,0,true],[300,100]]);
  fireRailgun(g,0,180);advance(g,0.2);
  assert.ok(g.bullet.active);assert.equal(g.targets.length,1);
  assert.equal(g.endless.shots,1);assert.equal(g.endless.hitShots,0);assert.equal(g.endless.kills,0);
  assert.equal(g.endless.hp,5);
});
test('all schedule/tail, surviving enemies, bullet and pulse end before REST; REST three seconds',()=>{
  const g=start();fixture(g,[[150,0]]);
  triggerTacticalPing(g);fireRailgun(g,0,150);advance(g,0.16);
  assert.equal(g.targets.length,0);assert.equal(g.state,'PLAYING');
  advance(g,0.20);assert.equal(g.state,'WAVE_REST');
  const remaining=g.endless.restRemaining;assert.ok(remaining>2.99);
  assert.equal(fireRailgun(g),false);assert.equal(triggerTacticalPing(g),false);
  advance(g,remaining-0.01);assert.equal(g.state,'WAVE_REST');
  advance(g,0.01);assert.equal(g.endless.wave,2);assert.equal(g.tacticalPingRemaining,1);
  assert.equal(fireRailgun(g),false);advance(g,0.25);assert.ok(fireRailgun(g));
  const a=start();
  for(let i=0;i<799;i++){a.targets=[];stepGame(a,0.01);assert.equal(a.state,'PLAYING');}
  a.targets=[];advance(a,0.01);assert.equal(a.state,'WAVE_REST');
});
test('HP saturation, immutable zero-shot result and retry/title/campaign resets',()=>{
  const g=start();fixture(g,Array(7).fill([30,0]));advance(g,0.01);
  assert.equal(g.endless.hp,0);assert.equal(g.state,'ENDLESS_RESULT');
  assert.equal(g.lastResult.accuracy,null);const r=g.lastResult;
  advance(g,2);assert.equal(g.lastResult,r);assert.ok(Object.isFrozen(r));
  retryCurrentRound(g);assert.equal(g.endless.wave,1);assert.equal(g.endless.hp,5);
  returnToTitle(g);assert.equal(g.state,'TITLE');assert.equal(g.endless,null);
  initRound(g,10,0,true);assert.equal(g.targets.length,4);assert.equal(g.mode,'CAMPAIGN');
});
test('selection/prediction use observations only, never hidden truth/phase',()=>{
  const g=start();fixture(g,[[200,0],[-200,0]]);
  for(const t of g.targets)recordBlip(g,t);
  g.roundTime=1;
  for(const t of g.targets){t.x*=0.9;t.r=180;recordBlip(g,t);}
  setAimFromCoords(g,-180,0);assert.equal(selectObservedTarget(g).targetId,'fixture-1');
  const before=computeDynamicLeadPrediction(g);
  Object.assign(g.targets[1],{x:999,y:999,theta:2,isBoosted:true,spawnedAt:-999,kind:'P'});
  assert.deepEqual(computeDynamicLeadPrediction(g),before);
  g.blipHistory=[];assert.equal(selectObservedTarget(g),null);assert.equal(computeDynamicLeadPrediction(g),null);
});
test('Q all 72 bearings: first observation + 1.15s response then observed-bearing shot before breach',()=>{
  let runs=0,maxFirst=0,minMargin=Infinity,maxQ=0;
  for(const wave of [6,8])for(let phase=0;phase<72;phase++) {
    const g=start(wave,phase*TWO_PI/72),q=g.targets[0],born=q.spawnedAt;
    let first=null;
    for(let n=0;n<2000;n++) {
      stepGame(g,0.005);
      const b=g.blipHistory.find(b=>b.targetId===q.id);
      if(b){first={...b};break;}
    }
    assert.ok(first);maxFirst=Math.max(maxFirst,first.detectedAt-born);
    advance(g,1.15,0.005);assert.ok(fireRailgun(g,first.theta,first.r));
    advance(g,0.36,0.005);
    assert.ok(q.destroyed);assert.equal(g.endless.hp,5);
    const deadline=wave===6?5.1:4.25;
    minMargin=Math.min(minMargin,born+deadline-g.roundTime);
    const b=start(wave,phase*TWO_PI/72);b.endless.hp=1000;
    maxQ=Math.max(maxQ,b.targets.filter(t=>t.kind==='Q').length);
    const t=b.targets[0];while(!t.breached && b.roundTime-t.spawnedAt<6)stepGame(b,0.005);
    assert.ok(Math.abs(b.roundTime-t.spawnedAt-deadline)<=0.00501);
    runs++;
  }
  console.log({qPhaseCases:runs,maxFirstObservationSeconds:maxFirst,
    responseSeconds:1.15,minConservativeHitToBreachSeconds:minMargin,maxQ});
});
console.log(`Endless core: ${count} tests passed.`);
