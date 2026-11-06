// Mechanical observation-only policies and an offline deadline-feasibility audit.
// Neither is a claim about novice/human performance.
import assert from 'node:assert/strict';
import { createGameState,startEndless,stepGame,fireRailgun,computeDynamicLeadPrediction,
  ENDLESS_FORMS as FORMS, TWO_PI, buildEndlessWavePlan } from '../src/engine.js';
const names=Object.fromEntries(Object.entries(FORMS).map(([k,v])=>[v.name,k]));
function start(w,angle) {
  const g=startEndless(createGameState(),angle,true);
  if(w>1){g.endless.wave=w-1;g.state='WAVE_REST';g.endless.restRemaining=0.01;stepGame(g,0.01);}
  g.stateTimer=0.25;g.endless.hp=1000;
  return g;
}
function canSchedule(jobs,time=-Infinity) {
  if(!jobs.length)return true;
  for(let i=0;i<jobs.length;i++){
    const j=jobs[i],at=Math.max(j.release,time);
    if(at<=j.deadline+1e-8 && canSchedule(jobs.filter((_,k)=>k!==i),at+2))return true;
  }
  return false;
}
let auditCases=0,minFirstToBreach=Infinity,maxLiveQ=0;
for(let w=1;w<=12;w++)for(let phase=0;phase<72;phase++) {
  const g=start(w,phase*TWO_PI/72),all=new Map(),first=new Map(),dead=new Map();
  for(let n=0;n<4500 && g.state!=='WAVE_REST';n++) {
    for(const t of g.targets)if(!t.isDecoy)all.set(t.id,t);
    for(const b of g.blipHistory)if(!b.isDecoy && !first.has(b.targetId))first.set(b.targetId,b.detectedAt);
    maxLiveQ=Math.max(maxLiveQ,g.targets.filter(t=>t.kind==='Q').length);
    stepGame(g,0.01);
    for(const [id,t] of all)if(t.breached && !dead.has(id))dead.set(id,g.roundTime);
  }
  assert.equal(g.state,'WAVE_REST');
  assert.equal(all.size,buildEndlessWavePlan(w).events.filter(e=>e.kind!=='F').length);
  const jobs=[...all].map(([id,t])=>{
    assert.ok(first.has(id),`undetected breach W${w} phase${phase} ${t.kind}`);
    minFirstToBreach=Math.min(minFirstToBreach,dead.get(id)-first.get(id));
    // Conservative single-observation recognition + response for every enemy,
    // and maximum bullet flight, even when it would hit much sooner.
    return {release:first.get(id)+1.15,deadline:dead.get(id)-0.36};
  });
  assert.ok(canSchedule(jobs),`unavoidable reload deadlines W${w} phase${phase}`);
  auditCases++;
}
assert.ok(maxLiveQ<=1);
console.log('DEADLINE AUDIT',JSON.stringify({auditCases,phaseStepDegrees:5,
  minFirstObservationToBreachSeconds:minFirstToBreach,maxLiveQ,
  inputDelaySeconds:1.15,conservativeFlightSeconds:0.36,reloadSeconds:2}));

function runPolicy(w,phase,adaptive) {
  const g=start(w,phase*TWO_PI/12),first=new Map(),lastAttempt=new Map();
  const attempted=[],outcomes=new Map();
  for(let n=0;n<6000 && g.state!=='WAVE_REST';n++) {
    // Bot input boundary: snapshots, clocks, weapon state only. No target truth.
    const latest=new Map();
    for(const b of g.blipHistory)if(!latest.has(b.targetId))latest.set(b.targetId,b);
    for(const b of latest.values())if(!first.has(b.targetId))first.set(b.targetId,b.detectedAt);
    if(g.state==='PLAYING' && g.ammo && !g.bullet?.active && g.stateTimer>=0.25) {
      const candidates=[...latest.values()].filter(b=>{
        const k=names[b.form.name];
        if(k==='F')return false; // Normally observed hologram outline, not hidden identity.
        if(g.roundTime-first.get(b.targetId)<(k==='Q'?1.15:0.25)-1e-8)return false;
        if(adaptive && k!=='Q' && !computeDynamicLeadPrediction(g,b.targetId))return false;
        return lastAttempt.get(b.targetId)!==b.detectedAt;
      });
      // Prioritize estimated deadline using observed range and observed codename.
      const speed=k=>k==='Q'?72:['P','B'].includes(k)?46:['L','D'].includes(k)?40:25;
      candidates.sort((a,b)=>(a.r-34)/speed(names[a.form.name])-(b.r-34)/speed(names[b.form.name]));
      const b=candidates[0];
      if(b) {
        const k=names[b.form.name];
        let x=b.x,y=b.y;
        if(adaptive && k!=='Q') {
          const p=computeDynamicLeadPrediction(g,b.targetId);
          x=p.x;y=p.y;
        }
        if(fireRailgun(g,Math.atan2(y,x),Math.hypot(x,y))) {
          lastAttempt.set(b.targetId,b.detectedAt);
          attempted.push({id:b.targetId,kind:k,bullet:g.bullet});
        }
      }
    }
    for(const t of g.targets)outcomes.set(t.id,t);
    stepGame(g,0.01);
  }
  assert.equal(g.state,'WAVE_REST');
  const byKind={};
  for(const t of outcomes.values())if(!t.isDecoy){
    const a=byKind[t.kind]??={kills:0,breaches:0,aimedShots:0,hitShots:0};
    a[t.destroyed?'kills':'breaches']++;
  }
  for(const attempt of attempted) {
    const a=byKind[attempt.kind]??={kills:0,breaches:0,aimedShots:0,hitShots:0};
    a.aimedShots++;if(attempt.bullet.hitCounted)a.hitShots++;
  }
  return {kills:g.endless.kills,breaches:1000-g.endless.hp,shots:g.endless.shots,
    hits:g.endless.hitShots,byKind};
}
const totals={};
for(const adaptive of [false,true]) {
  const s={runs:0,kills:0,breaches:0,shots:0,hits:0,perfectWaves:0,byKind:{}};
  for(let w=1;w<=12;w++)for(let phase=0;phase<12;phase++) {
    const r=runPolicy(w,phase,adaptive);s.runs++;
    for(const key of ['kills','breaches','shots','hits'])s[key]+=r[key];
    if(!r.breaches)s.perfectWaves++;
    for(const [k,v] of Object.entries(r.byKind)){
      const a=s.byKind[k]??={kills:0,breaches:0,aimedShots:0,hitShots:0};
      for(const field of Object.keys(a))a[field]+=v[field];
    }
  }
  s.accuracyPercent=+(100*s.hits/s.shots).toFixed(2);
  totals[adaptive?'observedAdaptive':'latestPoint']=s;
}
console.log('POLICY COMPARISON',JSON.stringify(totals));
console.log('PASS policy comparison: 288 wave runs + 864 deadline phase audits; no tuning from outcomes.');
