// Core Deterministic Engine for BLIND RADAR SHOT
// Implements all spatial parameters, sweep detection, tactical pulse, 10-round trajectories (WAVE 1 + WAVE 2 OVERDRIVE),
// continuous line-segment hit detection, minMissDistance & CPA tracking, and distance-proportional scoring per plan-r10.md.

export const TWO_PI = Math.PI * 2;
export const MAX_ROUNDS = 10;

// Endless-only tuning; campaign constants/trajectories below are unchanged.
export const ENDLESS_CONFIG = Object.freeze({
  CORE_HP: 5, RELOAD_SECONDS: 2, REST_SECONDS: 3, SPAWN_INTERVAL: 3.2,
  SPAWN_RADIUS: 340, CORE_HIT_DIST: 34, MAX_ENEMIES: 8,
  INPUT_GUARD: 0.25, TAIL_SECONDS: 1.6,
  enemies: wave => buildEndlessWavePlan(wave).events.length
});

// Campaign silhouettes, endless-only age-based motion. Observation snapshots only.
export const ENDLESS_FORMS = Object.freeze({
  L: Object.freeze({ name: 'STRAIGHT APPROACH', shapeType: 'delta_lance' }),
  D: Object.freeze({ name: 'HYPER LANCE', shapeType: 'delta_lance' }),
  C: Object.freeze({ name: 'ORBITAL SPIRAL', shapeType: 'crescent_wing' }),
  V: Object.freeze({ name: 'ELLIPTIC VORTEX', shapeType: 'crescent_wing' }),
  B: Object.freeze({ name: 'PHANTOM ACCEL', shapeType: 'twin_thruster' }),
  P: Object.freeze({ name: 'PHANTOM BLINK', shapeType: 'twin_thruster' }),
  S: Object.freeze({ name: 'ZIGZAG VECTOR', shapeType: 'sidewinder' }),
  H: Object.freeze({ name: 'VIPER SLALOM', shapeType: 'sidewinder' }),
  M: Object.freeze({ name: 'DUAL ECHO', shapeType: 'stealth_dreadnought' }),
  F: Object.freeze({ name: 'HOLOGRAM PRISM', shapeType: 'hologram_prism' }),
  Q: Object.freeze({ name: 'ランス III', shapeType: 'long_lance' })
});

const ENDLESS_SCORES = [
  [[0,'L'],[3.2,'L'],[6.4,'L']],
  [[0,'C'],[3.2,'L'],[6.4,'C'],[9.6,'L']],
  [[0,'D'],[3.2,'L'],[6.4,'D'],[9.6,'C']],
  [[0,'B'],[3.2,'L'],[6.4,'B'],[9.6,'C'],[12.8,'D']],
  [[0,'S'],[3.2,'L'],[6.4,'S'],[9.6,'C'],[12.8,'D','L']],
  [[0,'Q'],[5.2,'L'],[8.4,'C'],[11.6,'D'],[14.8,'B'],[18,'S']],
  [[0,'M','F'],[5.2,'L'],[8.4,'C'],[11.6,'D'],[14.8,'B'],[18,'S']],
  [[0,'Q'],[2,'C'],[5.2,'L'],[8.4,'D'],[11.6,'B'],[14.8,'S'],[18,'C']],
  [[0,'P'],[4,'L'],[7.2,'Q'],[9.2,'C'],[12.4,'D'],[15.6,'B'],[18.8,'S']],
  [[0,'H'],[4,'L'],[7.2,'Q'],[9.2,'S'],[12.4,'C'],[15.6,'M','F']],
  [[0,'Q'],[2,'C'],[5.2,'P'],[8.4,'S'],[11.6,'M','F'],[16,'D','B']],
  [[0,'V'],[4,'L'],[7.2,'Q'],[9.2,'C'],[12.4,'H'],[15.6,'M','F'],[20,'P']]
];
const ENDLESS_HINTS = ['折線の照準と装填', '旋回の読み', '折線後は再照準', '加速後を再観測',
  '切返しと対向処理', 'ランスIIIは一観測から優先射撃', '輪郭で偽像識別 / パルスでFAKE確定',
  'ランスIIIを先に、旋回を次に', '横変位後は再観測', '短周期とIII・偽像',
  '総合処理 / 対向ペア', '強旋回と終盤混成'];

// Immutable finite slots, including F. Bearings depend on the score, not survivors.
export function buildEndlessWavePlan(wave) {
  const w = Math.max(1, Math.floor(wave));
  const base = w <= 12 ? w : 10 + (w - 13) % 3;
  const rotation = w <= 12 ? 0 : (1 + Math.floor((w - 13) / 3)) * Math.PI / 2;
  const events = [];
  let previous = -2.399963229728653;
  for (const [at, ...kinds] of ENDLESS_SCORES[base - 1]) {
    const bearing = previous + 2.399963229728653;
    const sign = (events.length + base) % 2 ? 1 : -1;
    const parentIndex = events.length;
    kinds.forEach((kind, i) => {
      events.push(Object.freeze({ at, kind, sign,
        bearing: bearing + rotation + (i && kind !== 'F' ? Math.PI : 0),
        ...(kind === 'F' ? { parentIndex } : {}),
        speed: kind === 'Q' ? (base === 6 ? 60 : 72) : undefined }));
    });
    previous = bearing + (kinds.length > 1 && kinds[1] !== 'F' ? Math.PI : 0);
  }
  return Object.freeze({
    label: ENDLESS_HINTS[base - 1],
    events: Object.freeze(events),
    assaultEndsAt: events.at(-1).at + ENDLESS_CONFIG.TAIL_SECONDS
  });
}

const smooth = u => { u = Math.max(0, Math.min(1, u)); return u*u*(3-2*u); };
// Integral of smoothstep, including the linear tail after the ramp.
const smoothIntegral = (age, at, duration) => {
  const u = Math.max(0, Math.min(1, (age-at)/duration));
  return duration*(u*u*u - u*u*u*u/2) + Math.max(0, age-at-duration);
};
const triangleAge = (age, period) => {
  const q = Math.floor(age/period), rest = age-q*period;
  return q % 2 ? period-rest : rest;
};

// Deterministic position at age: no numerical integration, no frame-rate drift.
export function evaluateEndlessPosition(kind, age, theta0 = 0, sign = 1, speed = 72) {
  const a = Math.max(0, age), s = sign;
  let r = 340, theta = theta0;
  if (kind === 'L' || kind === 'D') {
    const polar = (radius, offset) => [radius*Math.cos(theta0+s*offset), radius*Math.sin(theta0+s*offset)];
    const points = kind === 'L' ? [polar(340,0),polar(75,0.42*Math.PI),[0,0]]
      : [polar(340,0),polar(190,0.24*Math.PI),polar(65,-0.10*Math.PI),[0,0]];
    const speeds = kind === 'L' ? [28,32] : [38,38,40];
    let remaining = a, x = 0, y = 0;
    for (let i=0;i<speeds.length;i++) {
      const [ax,ay]=points[i], [bx,by]=points[i+1];
      const duration = Math.hypot(bx-ax,by-ay)/speeds[i];
      if (remaining <= duration) {
        const u=remaining/duration;
        x=ax+(bx-ax)*u; y=ay+(by-ay)*u; break;
      }
      remaining-=duration;
    }
    return { x,y,r:Math.hypot(x,y),theta:normalizeAngle(Math.atan2(y,x)) };
  }
  switch (kind) {
    case 'C': r-=22*a; theta+=s*0.22*a; break;
    case 'V': r-=25*a-5*Math.sin(1.8*a); theta+=s*(0.20*a+0.012*a*a); break;
    case 'B': r-=20*a+19*smoothIntegral(a,6,0.4); theta+=s*0.12*a; break;
    case 'P': r-=22*a+24*smoothIntegral(a,5,0.25);
      theta+=s*(0.16*a+0.06*Math.max(0,a-5)+0.29*smooth((a-5)/0.80)); break;
    case 'S': r-=24*a; theta+=s*0.24*triangleAge(a,3.6); break;
    case 'H': r-=25*a; theta+=s*0.28*triangleAge(a,2.2); break;
    case 'M': r-=24*a; theta+=s*0.22*a; break;
    case 'F': r=Math.max(60,340-24*a+22*Math.sin(1.8*a));
      theta+=s*(0.65+0.22*a+0.22*Math.sin(1.5*a)); break;
    case 'Q': r-=speed*a; break;
    default: throw new Error(`Unknown endless key: ${kind}`);
  }
  r=Math.max(0,r); theta=normalizeAngle(theta);
  return { x:r*Math.cos(theta),y:r*Math.sin(theta),r,theta };
}

// Public instantaneous velocity API, evaluated from the same age-based path.
export function endlessMotion(kind, age, sign = 1, speed = 72) {
  const p=evaluateEndlessPosition(kind,age,0,sign,speed);
  const n=evaluateEndlessPosition(kind,age+0.00001,0,sign,speed);
  return { radialSpeed:(p.r-n.r)/0.00001,
    omega:shortestAngleDiff(p.theta,n.theta)/0.00001 };
}

export const CONSTANTS = {
  MAX_ROUNDS: 10,
  RADAR_RADIUS: 360,
  RANGE_RINGS: [90, 180, 270, 360],
  SUB_RANGE_RINGS: [45, 135, 225, 315],
  LONG_SNIPE_RADIUS: 240,
  DANGER_RADIUS: 120,
  CORE_RADIUS: 18,
  TARGET_RADIUS: 16,
  CORE_HIT_DIST: 34, // CORE_RADIUS (18) + TARGET_RADIUS (16)
  BULLET_RADIUS: 8,
  R_HIT: 28.0, // Direct line-segment hit radius (expanded for human playability)
  BLAST_RADIUS: 44.0, // Target-point EMP plasma detonation AOE radius at clicked aim point
  BULLET_SPEED: 1000.0,
  BULLET_MAX_RANGE: 360,
  SWEEP_INITIAL_ANGLE: (3 * Math.PI) / 2, // 12 o'clock (-pi/2 mod 2pi)
  SWEEP_OMEGA: 1.25 * Math.PI, // 225 deg/s (1.60s per full revolution)
  SWEEP_DETECT_COOLDOWN: 0.40,
  BLIP_MAX_PER_TARGET: 4,
  BLIP_LIFETIME: 6.0,
  PULSE_SPEED: 1440.0, // reaches 360px in 0.25s
  BRIEFING_DURATION: 1.2,
  CLEAR_INPUT_GUARD: 0.25,
  FAIL_INPUT_GUARD: 0.20
};

export const ROUND_DEFS = [
  {
    round: 1,
    codeName: 'STRAIGHT APPROACH',
    profile: 'Linear Offset Vector',
    desc: '反応を2回以上見比べ、黄色の予測円を敵の進行先に重ねて撃つ。'
  },
  {
    round: 2,
    codeName: 'ORBITAL SPIRAL',
    profile: 'Constant Angular Velocity',
    desc: '敵は弧を描く。古い線より、直近の曲がり方を優先。'
  },
  {
    round: 3,
    codeName: 'PHANTOM ACCEL',
    profile: 'Two-Stage Boost (r <= 230m)',
    desc: '反応点の間隔が広がったら加速後。新しい反応を待って狙う。'
  },
  {
    round: 4,
    codeName: 'ZIGZAG VECTOR',
    profile: 'Periodic Turn (Every 3.6s)',
    desc: '折り返し後は進行方向が逆になる。迷ったらパルスで再確認。'
  },
  {
    round: 5,
    codeName: 'DUAL ECHO',
    profile: 'Stealth Target + Electronic Decoy',
    desc: '本物と偽物が混じる。パルスを使うと偽物の反応を見分けやすい。'
  },
  {
    round: 6,
    codeName: 'HYPER LANCE',
    profile: 'Dogleg Linear Vector (Turn at r=190m)',
    desc: '中距離で進路が折れる。曲がる前の反応だけで撃たない。'
  },
  {
    round: 7,
    codeName: 'ELLIPTIC VORTEX',
    profile: 'Accelerating Angular Spiral',
    desc: '接近するほど曲がりが強くなる。最新の反応を狙いに使う。'
  },
  {
    round: 8,
    codeName: 'PHANTOM BLINK',
    profile: 'Boost + Lateral Phase Shift (r <= 240m)',
    desc: '中距離で急加速・変針する。変化後の反応を待って狙う。'
  },
  {
    round: 9,
    codeName: 'VIPER SLALOM',
    profile: 'High-Freq Slalom (2.2s) + Decoy',
    desc: '敵は左右に切り返す。古い方向に引っぱられないよう注意。'
  },
  {
    round: 10,
    codeName: 'OMEGA MIRAGE',
    profile: 'Stealth Boss + Triple Electronic Decoys',
    desc: '4つの反応が同時に現れる。パルスで偽物を見分けてから撃つ。'
  }
];

export function normalizeAngle(a) {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

export function shortestAngleDiff(fromAngle, toAngle) {
  return ((((toAngle - fromAngle + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
}

export function isAngleSwept(thetaPrev, thetaCurr, targetAngle) {
  const p = normalizeAngle(thetaPrev);
  const c = normalizeAngle(thetaCurr);
  const t = normalizeAngle(targetAngle);

  if (p <= c) {
    return t >= p && t <= c;
  } else {
    // 2π -> 0 wrap-around
    return t >= p || t <= c;
  }
}

// Check if rotating sweep crossed moving target angle from prev frame to curr frame
export function didSweepCrossTarget(sweepPrev, sweepCurr, targetPrev, targetCurr) {
  if (isAngleSwept(sweepPrev, sweepCurr, targetCurr)) return true;
  if (isAngleSwept(sweepPrev, sweepCurr, targetPrev)) return true;

  // Also check relative angle (sweep - target) crossing 0 in clockwise direction
  const relPrev = normalizeAngle(sweepPrev - targetPrev);
  const relCurr = normalizeAngle(sweepCurr - targetCurr);
  // Since sweep angular velocity (pi rad/s) > max target angular velocity (0.4 rad/s),
  // relative angle increases clockwise and wraps around from ~2pi to ~0 when crossing.
  if (relPrev > Math.PI && relCurr < Math.PI) {
    return true;
  }
  return false;
}

// Shortest distance between line segment AB and point P, plus closest point on AB
export function segmentToPointDetails(ax, ay, bx, by, px, py) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  let t = 0;
  if (lenSq > 1e-9) {
    t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  }
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  const dx = px - cx;
  const dy = py - cy;
  return {
    dist: Math.sqrt(dx * dx + dy * dy),
    closestX: cx,
    closestY: cy,
    t
  };
}

export function distSegmentToPoint(ax, ay, bx, by, px, py) {
  return segmentToPointDetails(ax, ay, bx, by, px, py).dist;
}

export function isDecoyTarget(targetId) {
  return Boolean(targetId && (String(targetId).startsWith('decoy') || targetId !== 'main'));
}

export function getTargetShapeType(round, targetId = 'main') {
  if (isDecoyTarget(targetId)) return 'hologram_prism';
  const baseRound = ((Math.max(1, Math.floor(round || 1)) - 1) % 5) + 1;
  switch (baseRound) {
    case 1:
      return 'delta_lance';
    case 2:
      return 'crescent_wing';
    case 3:
      return 'twin_thruster';
    case 4:
      return 'sidewinder';
    case 5:
    default:
      return 'stealth_dreadnought';
  }
}

export function computeDistanceScore(rImpact) {
  const r = Math.max(0, Number(rImpact) || 0);
  if (r >= CONSTANTS.DANGER_RADIUS) {
    const u = Math.max(0, Math.min(1, (r - 120) / (340 - 120)));
    return Math.round(2000 + 4000 * u);
  } else {
    const uDanger = Math.max(0, Math.min(1, (r - 34) / (120 - 34)));
    return Math.round(300 + 900 * uDanger * uDanger);
  }
}

// Raw coordinate evaluator at elapsed round time t (seconds) per plan.md & plan-r10.md
function evalRawCoords(round, targetId, t, theta0, s = 1) {
  const time = Math.max(0, t);

  if (round === 1) {
    // Round 1: STRAIGHT APPROACH
    const r0 = 340;
    const startX = r0 * Math.cos(theta0);
    const startY = r0 * Math.sin(theta0);
    const turnAngle = theta0 + s * 0.42 * Math.PI;
    const turnR = 75;
    const turnX = turnR * Math.cos(turnAngle);
    const turnY = turnR * Math.sin(turnAngle);

    const dx = turnX - startX;
    const dy = turnY - startY;
    const distPhase1 = Math.sqrt(dx * dx + dy * dy);
    const v1 = 28.0;
    const t1 = distPhase1 / v1;

    if (time <= t1) {
      const ratio = distPhase1 > 0 ? (v1 * time) / distPhase1 : 0;
      const x = startX + dx * ratio;
      const y = startY + dy * ratio;
      const r = Math.sqrt(x * x + y * y);
      const theta = normalizeAngle(Math.atan2(y, x));
      return { x, y, r, theta };
    } else {
      const v2 = 32.0;
      const r = Math.max(0, turnR - v2 * (time - t1));
      const theta = normalizeAngle(turnAngle);
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      return { x, y, r, theta };
    }
  }

  if (round === 2) {
    // Round 2: ORBITAL SPIRAL (milder angular & radial speed for smooth lead learning)
    const r = Math.max(0, 340 - 22.0 * time);
    const theta = normalizeAngle(theta0 + s * 0.22 * time);
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y, r, theta };
  }

  if (round === 3) {
    // Round 3: PHANTOM ACCEL (reduced lateral curve so player focuses on radial boost)
    const theta = normalizeAngle(theta0 + s * 0.12 * time);
    let r;
    if (time < 6.0) {
      r = 350 - 20.0 * time;
    } else {
      r = Math.max(0, 230 - 39.0 * (time - 6.0));
    }
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y, r, theta };
  }

  if (round === 4) {
    // Round 4: ZIGZAG VECTOR (3.6s period square-wave angular velocity, milder amplitude)
    const r = Math.max(0, 350 - 24.0 * time);
    const period = 3.6;
    const omegaMag = 0.24;
    const phaseIndex = Math.floor(time / period);
    const localT = time - phaseIndex * period;
    // Continuous integration of (-1)^phaseIndex * omegaMag
    const deltaTheta =
      phaseIndex % 2 === 0
        ? s * omegaMag * localT
        : s * omegaMag * (period - localT);
    const theta = normalizeAngle(theta0 + deltaTheta);
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y, r, theta };
  }

  if (round === 5) {
    // Round 5: DUAL ECHO (main + decoy, milder main speed after decoy identification)
    if (targetId === 'decoy') {
      const rawR = 350 - 24.0 * time + 22.0 * Math.sin(1.8 * time);
      const r = Math.max(60, rawR);
      const theta = normalizeAngle(
        theta0 + s * 0.65 + s * (0.22 * time + 0.22 * Math.sin(1.5 * time))
      );
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      return { x, y, r, theta };
    } else {
      const r = Math.max(0, 350 - 24.0 * time);
      const theta = normalizeAngle(theta0 + s * 0.22 * time);
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      return { x, y, r, theta };
    }
  }

  if (round === 6) {
    // Round 6: HYPER LANCE (R1 Overdrive: 2-stage dogleg linear vector, moderated turn & speed)
    const p0x = 345 * Math.cos(theta0);
    const p0y = 345 * Math.sin(theta0);
    const theta1 = theta0 + s * 0.24 * Math.PI;
    const p1x = 190 * Math.cos(theta1);
    const p1y = 190 * Math.sin(theta1);
    const theta2 = theta0 - s * 0.10 * Math.PI;
    const p2x = 65 * Math.cos(theta2);
    const p2y = 65 * Math.sin(theta2);

    const dx1 = p1x - p0x;
    const dy1 = p1y - p0y;
    const d1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const v1 = 38.0;
    const t1 = d1 / v1;

    const dx2 = p2x - p1x;
    const dy2 = p2y - p1y;
    const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const v2 = 38.0;
    const dt2 = d2 / v2;
    const t2 = t1 + dt2;

    if (time <= t1) {
      const ratio = d1 > 0 ? (v1 * time) / d1 : 0;
      const x = p0x + dx1 * ratio;
      const y = p0y + dy1 * ratio;
      const r = Math.sqrt(x * x + y * y);
      const theta = normalizeAngle(Math.atan2(y, x));
      return { x, y, r, theta };
    } else if (time <= t2) {
      const ratio = d2 > 0 ? (v2 * (time - t1)) / d2 : 0;
      const x = p1x + dx2 * ratio;
      const y = p1y + dy2 * ratio;
      const r = Math.sqrt(x * x + y * y);
      const theta = normalizeAngle(Math.atan2(y, x));
      return { x, y, r, theta };
    } else {
      const v3 = 40.0;
      const r = Math.max(0, 65 - v3 * (time - t2));
      const theta = normalizeAngle(theta2);
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      return { x, y, r, theta };
    }
  }

  if (round === 7) {
    // Round 7: ELLIPTIC VORTEX (R2 Overdrive: Smooth accelerating angular spiral without erratic radial oscillation)
    const r = Math.max(0, 345 - 25.0 * time + 5.0 * Math.sin(1.8 * time));
    const theta = normalizeAngle(theta0 + s * (0.20 * time + 0.012 * time * time));
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y, r, theta };
  }

  if (round === 8) {
    // Round 8: PHANTOM BLINK (R3 Overdrive: Boost + lateral phase blink at t >= 5.0s / r <= 240px)
    let r;
    let theta;
    if (time < 5.0) {
      r = 350 - 22.0 * time;
      theta = normalizeAngle(theta0 + s * 0.16 * time);
    } else {
      const tau = time - 5.0;
      const blinkShift = 0.29 * Math.min(1.0, tau / 0.25);
      r = Math.max(0, 240 - 46.0 * tau);
      theta = normalizeAngle(theta0 + s * (0.80 + blinkShift + 0.22 * tau));
    }
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y, r, theta };
  }

  if (round === 9) {
    // Round 9: VIPER SLALOM (R4 Overdrive: 2.2s slalom + 1 electronic decoy, playable angular amplitude)
    if (targetId === 'decoy') {
      const r = Math.max(60, 350 - 25.0 * time + 22.0 * Math.sin(2.4 * time));
      const theta = normalizeAngle(
        theta0 - s * 0.55 - s * (0.24 * time + 0.22 * Math.sin(2.0 * time))
      );
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      return { x, y, r, theta };
    } else {
      const r = Math.max(0, 350 - 25.0 * time);
      const period = 2.2;
      const omegaMag = 0.28;
      const phaseIndex = Math.floor(time / period);
      const localT = time - phaseIndex * period;
      const deltaTheta =
        phaseIndex % 2 === 0
          ? s * omegaMag * localT
          : s * omegaMag * (period - localT);
      const theta = normalizeAngle(theta0 + deltaTheta);
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      return { x, y, r, theta };
    }
  }

  // Round 10: OMEGA MIRAGE (R5 Overdrive: Stealth Boss + 3 Electronic Decoys)
  if (targetId === 'decoy') {
    const r = Math.max(60, 355 - 26.0 * time + 24.0 * Math.sin(2.0 * time));
    const theta = normalizeAngle(
      theta0 + s * 0.55 + s * (0.26 * time + 0.22 * Math.sin(1.7 * time))
    );
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y, r, theta };
  } else if (targetId === 'decoy2') {
    const r = Math.max(60, 355 - 25.0 * time + 26.0 * Math.cos(2.3 * time));
    const theta = normalizeAngle(
      theta0 - s * 0.60 + s * (0.25 * time - 0.24 * Math.sin(1.9 * time))
    );
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y, r, theta };
  } else if (targetId === 'decoy3') {
    const r = Math.max(60, 355 - 27.0 * time + 20.0 * Math.sin(2.6 * time + 1.2));
    const theta = normalizeAngle(
      theta0 + s * 1.25 - s * (0.22 * time + 0.20 * Math.cos(1.6 * time))
    );
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y, r, theta };
  } else {
    const r = Math.max(0, 355 - 25.0 * time);
    const theta = normalizeAngle(theta0 + s * 0.24 * time);
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y, r, theta };
  }
}

// Evaluate target position, heading angle & maneuver state at elapsed round time t (seconds)
export function computeTargetCoords(round, targetId, t, theta0, s = 1) {
  const time = Math.max(0, t);
  const cur = evalRawCoords(round, targetId, time, theta0, s);
  const dtHeading = 0.01;
  const next = evalRawCoords(round, targetId, time + dtHeading, theta0, s);
  const vx = next.x - cur.x;
  const vy = next.y - cur.y;
  const heading =
    vx * vx + vy * vy > 1e-8
      ? Math.atan2(vy, vx)
      : normalizeAngle(cur.theta + Math.PI);

  const shapeType = getTargetShapeType(round, targetId);
  const isBoosted =
    (round === 3 && (time >= 6.0 || cur.r <= 230.0 + 1e-6)) ||
    (round === 8 && (time >= 5.0 || cur.r <= 240.0 + 1e-6));
  const period = round === 9 ? 2.2 : 3.6;
  const phaseIndex = Math.floor(time / period);
  const zigzagDir = (phaseIndex % 2 === 0 ? 1 : -1) * s;
  const turnDir = round === 4 || round === 9 ? zigzagDir : s;

  return {
    x: cur.x,
    y: cur.y,
    r: cur.r,
    theta: cur.theta,
    heading,
    shapeType,
    isBoosted,
    zigzagDir,
    turnDir,
    turnSign: s
  };
}

export function createGameState(audio = null) {
  let bestScore = 0;
  let bestRank = '-';
  try {
    if (typeof localStorage !== 'undefined') {
      bestScore = Number(localStorage.getItem('blind_radar_shot_best_score')) || 0;
      bestRank = localStorage.getItem('blind_radar_shot_best_rank') || '-';
    }
  } catch (_) {}

  return {
    mode: 'CAMPAIGN',
    endless: null,
    // Required public properties on window.__GAME_STATE__
    state: 'TITLE', // 'TITLE' | 'BRIEFING' | 'PLAYING' | 'SHOT_FLYING' | 'RESULT_CLEAR' | 'RESULT_FAIL' | 'ALL_CLEAR'
    round: 1,
    ammo: 1,
    tacticalPingRemaining: 1,
    sweepAngle: CONSTANTS.SWEEP_INITIAL_ANGLE,
    targets: [],
    blipHistory: [],
    bullet: null,
    lastResult: null,
    totalScore: 0,

    // Additional runtime & presentation state
    roundTime: 0,
    stateTimer: 0,
    theta0: 0.25 * Math.PI,
    turnSign: 1,
    aimAngle: -Math.PI / 4,
    aimDist: 220,
    aimX: 220 * Math.cos(-Math.PI / 4),
    aimY: 220 * Math.sin(-Math.PI / 4),
    firedAimDist: 220,
    firedAimX: 0,
    firedAimY: 0,
    firedAtTime: 0,
    lastMainDetectedAt: null,
    nextBlipId: 1,
    allBlipsLog: [], // Full blip history for Unveil display
    trajectoryLog: { main: [], decoy: [], decoy2: [], decoy3: [] },
    lastTrajectorySampleTime: -1,
    activePulse: null, // { rPrev, rCurr, active, detectedIds: Set }
    cpaInfo: null, // { minCenterDist, bulletX, bulletY, enemyX, enemyY, time, decoyHit }
    roundScores: Array(MAX_ROUNDS).fill(0),
    roundResults: Array(MAX_ROUNDS).fill(null),
    bestScore,
    bestRank,
    effects: {
      muzzleFlashTimer: 0,
      screenFlashTimer: 0,
      screenShakeTimer: 0,
      screenShakeMagnitude: 0,
      hitStopTimer: 0,
      northPassHighlightTimer: 0,
      pulseBannerTimer: 0,
      particles: [],
      shockwaves: []
    },
    audio
  };
}

function logTrajectoryPoint(game, force = false) {
  if (!force && game.roundTime - game.lastTrajectorySampleTime < 0.045) return;
  game.lastTrajectorySampleTime = game.roundTime;
  for (const tgt of game.targets) {
    const arr = game.trajectoryLog[tgt.id];
    if (arr) {
      arr.push({ x: tgt.x, y: tgt.y, r: tgt.r, theta: tgt.theta, t: game.roundTime });
    }
  }
}

export function initRound(game, roundNumber = 1, seedOrInitialAngle = undefined, skipBriefing = false) {
  game.mode = 'CAMPAIGN';
  game.endless = null;
  const rNum = Math.max(1, Math.min(MAX_ROUNDS, Math.floor(roundNumber)));
  game.round = rNum;
  game.roundTime = 0;
  game.stateTimer = 0;
  game.ammo = 1;
  game.tacticalPingRemaining = 1;
  game.sweepAngle = CONSTANTS.SWEEP_INITIAL_ANGLE;
  game.blipHistory = [];
  game.allBlipsLog = [];
  game.nextBlipId = 1;
  game.bullet = null;
  game.activePulse = null;
  game.cpaInfo = null;
  game.lastMainDetectedAt = null;
  game.lastTrajectorySampleTime = -1;
  game.trajectoryLog = { main: [], decoy: [], decoy2: [], decoy3: [] };

  // Reset visual effects
  game.effects.muzzleFlashTimer = 0;
  game.effects.screenFlashTimer = 0;
  game.effects.screenShakeTimer = 0;
  game.effects.screenShakeMagnitude = 0;
  game.effects.hitStopTimer = 0;
  game.effects.northPassHighlightTimer = 0;
  game.effects.pulseBannerTimer = 0;
  game.effects.particles = [];
  game.effects.shockwaves = [];

  if (typeof seedOrInitialAngle === 'number' && !Number.isNaN(seedOrInitialAngle)) {
    game.theta0 = normalizeAngle(seedOrInitialAngle);
    game.turnSign = 1;
  } else {
    game.theta0 = normalizeAngle(Math.random() * TWO_PI);
    game.turnSign = Math.random() < 0.5 ? 1 : -1;
  }

  let targetIds = ['main'];
  if (rNum === 5 || rNum === 9) {
    targetIds = ['main', 'decoy'];
  } else if (rNum === 10) {
    targetIds = ['main', 'decoy', 'decoy2', 'decoy3'];
  }

  game.targets = targetIds.map(id => {
    const pos = computeTargetCoords(rNum, id, 0, game.theta0, game.turnSign);
    return {
      id,
      x: pos.x,
      y: pos.y,
      r: pos.r,
      theta: pos.theta,
      heading: pos.heading,
      shapeType: pos.shapeType,
      turnSign: game.turnSign,
      turnDir: pos.turnDir,
      zigzagDir: pos.zigzagDir,
      isBoosted: pos.isBoosted,
      visibleDirectly: false,
      lastSweepDetectAt: -999,
      destroyed: false
    };
  });

  logTrajectoryPoint(game, true);

  game.state = skipBriefing ? 'PLAYING' : 'BRIEFING';
  if (game.audio) {
    game.audio.playBootBeep();
  }
  return game;
}

export function recordBlip(game, target, source = 'sweep') {
  const isDecoy = target.isDecoy ?? isDecoyTarget(target.id);
  const isDecoyEcho = source === 'pulse' && isDecoy;
  if (game.mode === 'ENDLESS' && isDecoyEcho) {
    target.revealed = true;
    for (const b of game.blipHistory) {
      if (b.targetId === target.id) b.isDecoyEcho = true;
    }
  }

  const blip = {
    id: game.nextBlipId++,
    targetId: target.id,
    isDecoy,
    round: game.round,
    shapeType: target.shapeType || getTargetShapeType(game.round, target.id),
    form: target.form,
    x: target.x,
    y: target.y,
    r: target.r,
    theta: target.theta,
    heading:
      typeof target.heading === 'number'
        ? target.heading
        : normalizeAngle(target.theta + Math.PI),
    turnSign: target.turnSign ?? game.turnSign ?? 1,
    turnDir: target.turnDir ?? target.zigzagDir ?? target.turnSign ?? 1,
    zigzagDir: target.zigzagDir ?? target.turnDir ?? 1,
    isBoosted: Boolean(target.isBoosted),
    detectedAt: game.roundTime,
    source,
    isDecoyEcho: isDecoyEcho || (game.mode === 'ENDLESS' && Boolean(target.revealed))
  };

  // Prepend to blipHistory and keep max 4 per targetId
  game.blipHistory.unshift(blip);
  game.allBlipsLog.push({ ...blip });

  let countForTarget = 0;
  for (let i = 0; i < game.blipHistory.length; i++) {
    if (game.blipHistory[i].targetId === target.id) {
      countForTarget++;
      if (countForTarget > CONSTANTS.BLIP_MAX_PER_TARGET) {
        game.blipHistory.splice(i, 1);
        i--;
      }
    }
  }

  if (target.id === 'main') {
    game.lastMainDetectedAt = game.roundTime;
  }

  if (game.audio) {
    const distRatio = Math.max(0, Math.min(1, target.r / CONSTANTS.RADAR_RADIUS));
    game.audio.playSonarPing(distRatio, isDecoy);
    if ((target.id === 'main' || target.isDecoy === false) && target.r <= CONSTANTS.DANGER_RADIUS) {
      game.audio.playDangerHeartbeat();
    }
  }

  return blip;
}

export function triggerTacticalPing(game) {
  if (game.state !== 'PLAYING') return false;
  if (game.mode === 'ENDLESS' && game.stateTimer < ENDLESS_CONFIG.INPUT_GUARD) return false;
  if (game.tacticalPingRemaining <= 0) return false;

  game.tacticalPingRemaining = 0;
  game.activePulse = {
    rPrev: 0,
    rCurr: 0,
    active: true,
    detectedIds: new Set()
  };
  game.effects.pulseBannerTimer = 1.0;

  if (game.audio) {
    game.audio.playTacticalPulse();
  }
  return true;
}

// Compute real-time dynamic lead prediction (Dynamic Lead Ghost) from observed blips only
export function computeDynamicLeadPrediction(game, targetId = undefined) {
  if (!game || !Array.isArray(game.blipHistory)) return null;
  targetId ??= game.mode === 'ENDLESS' ? selectObservedTarget(game)?.targetId : 'main';
  const list = game.blipHistory.filter(b => b.targetId === targetId);
  if (list.length < 2) return null;

  const b0 = list[0];
  const b1 = list[1];
  const dt1 = b0.detectedAt - b1.detectedAt;
  if (dt1 <= 0.05) return null;

  // Linear velocity components from last 2 blips
  const vx = (b0.x - b1.x) / dt1;
  const vy = (b0.y - b1.y) / dt1;

  // Polar radial & angular velocity components from last 2 blips
  const vr = (b0.r - b1.r) / dt1;
  const omega = shortestAngleDiff(b1.theta, b0.theta) / dt1;

  // Blend ratio between linear and polar extrapolation per round profile
  const round = game.round || b0.round || 1;
  let alphaPolar = 0.75;
  if (game.mode === 'ENDLESS') {
    alphaPolar = 0.75;
  } else if (round === 1 || round === 6) {
    alphaPolar = 0.0;
  } else if (round === 4 || round === 9) {
    alphaPolar = 0.35;
  }

  const dtBlind = Math.max(0, game.roundTime - b0.detectedAt);
  const tauNow = Math.min(2.8, dtBlind);

  const xNowLin = b0.x + vx * tauNow;
  const yNowLin = b0.y + vy * tauNow;
  const rNowPol = Math.max(25, b0.r + vr * tauNow);
  const thetaNowPol = b0.theta + omega * tauNow;
  const xNowPol = rNowPol * Math.cos(thetaNowPol);
  const yNowPol = rNowPol * Math.sin(thetaNowPol);

  const currentEstX = (1 - alphaPolar) * xNowLin + alphaPolar * xNowPol;
  const currentEstY = (1 - alphaPolar) * yNowLin + alphaPolar * yNowPol;

  // Iterate 3 times to converge bullet time-of-flight (ETA) to predicted point
  let tFly = b0.r / CONSTANTS.BULLET_SPEED;
  let xPred = currentEstX;
  let yPred = currentEstY;

  for (let i = 0; i < 3; i++) {
    const tau = Math.min(3.2, dtBlind + tFly);
    const xLin = b0.x + vx * tau;
    const yLin = b0.y + vy * tau;

    const rPol = Math.max(25, b0.r + vr * tau);
    const thetaPol = b0.theta + omega * tau;
    const xPol = rPol * Math.cos(thetaPol);
    const yPol = rPol * Math.sin(thetaPol);

    xPred = (1 - alphaPolar) * xLin + alphaPolar * xPol;
    yPred = (1 - alphaPolar) * yLin + alphaPolar * yPol;

    const rPredRaw = Math.hypot(xPred, yPred);
    tFly = rPredRaw / CONSTANTS.BULLET_SPEED;
  }

  let rPred = Math.hypot(xPred, yPred);
  const maxAllowedR = CONSTANTS.RADAR_RADIUS - 10;
  if (rPred > maxAllowedR && rPred > 1e-6) {
    const scale = maxAllowedR / rPred;
    xPred *= scale;
    yPred *= scale;
    rPred = maxAllowedR;
  } else if (rPred < 25 && rPred > 1e-6) {
    const scale = 25 / rPred;
    xPred *= scale;
    yPred *= scale;
    rPred = 25;
  }

  const angle = normalizeAngle(Math.atan2(yPred, xPred));
  return {
    x: xPred,
    y: yPred,
    r: rPred,
    angle,
    currentEstX,
    currentEstY,
    eta: Number(tFly.toFixed(3)),
    dtBlind: Number(dtBlind.toFixed(3))
  };
}

export function setAimFromCoords(game, x, y) {
  const dist = Math.min(CONSTANTS.RADAR_RADIUS, Math.sqrt(x * x + y * y));
  const angle = normalizeAngle(Math.atan2(y, x));
  game.aimAngle = angle;
  game.aimDist = Math.max(20, dist);
  game.aimX = game.aimDist * Math.cos(angle);
  game.aimY = game.aimDist * Math.sin(angle);
}

export function setAimAngle(game, angleRad, distPx = undefined) {
  const angle = normalizeAngle(angleRad);
  game.aimAngle = angle;
  if (typeof distPx === 'number' && !Number.isNaN(distPx)) {
    game.aimDist = Math.max(20, Math.min(CONSTANTS.RADAR_RADIUS, distPx));
  }
  game.aimX = game.aimDist * Math.cos(angle);
  game.aimY = game.aimDist * Math.sin(angle);
}

export function fireRailgun(game, overrideAngleRad = undefined, overrideDistPx = undefined) {
  if (game.mode === 'ENDLESS') return fireEndless(game, overrideAngleRad, overrideDistPx);
  if (game.state !== 'PLAYING' || game.ammo <= 0) return false;

  if (typeof overrideAngleRad === 'number' && !Number.isNaN(overrideAngleRad)) {
    setAimAngle(game, overrideAngleRad, overrideDistPx);
  } else if (typeof overrideDistPx === 'number' && !Number.isNaN(overrideDistPx)) {
    setAimAngle(game, game.aimAngle, overrideDistPx);
  }

  game.ammo = 0;
  game.state = 'SHOT_FLYING';
  game.stateTimer = 0;
  game.firedAtTime = game.roundTime;
  game.firedAimDist = Math.max(20, Math.min(CONSTANTS.RADAR_RADIUS, game.aimDist));
  game.firedAimX = game.firedAimDist * Math.cos(game.aimAngle);
  game.firedAimY = game.firedAimDist * Math.sin(game.aimAngle);

  game.bullet = {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    r: 0,
    angle: game.aimAngle,
    elapsed: 0,
    active: true,
    blastTriggered: false
  };

  const mainTgt = game.targets.find(t => t.id === 'main');
  const initDist = mainTgt ? Math.sqrt(mainTgt.x * mainTgt.x + mainTgt.y * mainTgt.y) : 999;
  game.cpaInfo = {
    minCenterDist: initDist,
    bulletX: 0,
    bulletY: 0,
    enemyX: mainTgt ? mainTgt.x : 0,
    enemyY: mainTgt ? mainTgt.y : 0,
    enemyAngle: mainTgt ? mainTgt.theta : 0,
    time: game.roundTime,
    decoyHit: false
  };

  game.effects.muzzleFlashTimer = 0.12;
  if (game.audio) {
    game.audio.playRailgunShot();
  }
  return true;
}

function spawnHitParticles(game, x, y) {
  const colors = ['#FFFFFF', '#00FFAA', '#FFD166', '#38BDF8'];
  for (let i = 0; i < 32; i++) {
    const ang = (TWO_PI * i) / 32 + (Math.random() - 0.5) * 0.25;
    const speed = 60 + Math.random() * 220;
    game.effects.particles.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      size: 2.5 + Math.random() * 4.5,
      color: colors[i % colors.length],
      alpha: 1.0,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.9,
      shape: i % 3 // 0: triangle, 1: diamond, 2: streak
    });
  }
  game.effects.shockwaves.push(
    { x, y, r: 6, maxR: 120, color: '#00FFAA', alpha: 1.0, speed: 240 },
    { x, y, r: 2, maxR: 85, color: '#FFFFFF', alpha: 0.9, speed: 180 }
  );
}

function finalizeRoundClear(game, hitOffsetPx, impactX, impactY) {
  logTrajectoryPoint(game, true);
  for (const tgt of game.targets) {
    tgt.visibleDirectly = true;
    if (tgt.id === 'main') tgt.destroyed = true;
  }
  if (game.bullet) {
    game.bullet.x = impactX;
    game.bullet.y = impactY;
    game.bullet.r = Math.sqrt(impactX * impactX + impactY * impactY);
    game.bullet.active = false;
  }

  const mainTgt = game.targets.find(t => t.id === 'main');
  const rImpact =
    mainTgt && typeof mainTgt.r === 'number'
      ? mainTgt.r
      : Math.sqrt(impactX * impactX + impactY * impactY);
  const impactRadiusPx = Math.round(rImpact);

  // Distance-proportional score calculation per plan-r10.md Section 2.2
  const distanceScore = computeDistanceScore(rImpact);
  const baseScore = distanceScore;

  const blindTime =
    game.lastMainDetectedAt !== null
      ? Math.max(0, game.firedAtTime - game.lastMainDetectedAt)
      : 0.6;
  const blindBonus = Math.max(
    0,
    Math.min(1500, Math.round((blindTime / 1.2) * 1500))
  );
  const clampedOffset = Math.max(0, Math.min(CONSTANTS.R_HIT, hitOffsetPx));
  const precisionBonus = Math.round((1 - clampedOffset / CONSTANTS.R_HIT) * 1500);
  const noPingBonus = game.tacticalPingRemaining > 0 ? 1000 : 0;
  const totalRoundScore = distanceScore + precisionBonus + blindBonus + noPingBonus;

  let rank = 'B';
  if (totalRoundScore >= 7500) rank = 'S';
  else if (totalRoundScore >= 5500) rank = 'A';

  const isLongRangeSnipe = rImpact >= 240;
  const isDangerClose = rImpact < CONSTANTS.DANGER_RADIUS;
  const isBullseye = Math.round(clampedOffset) <= 6;
  const isBlindSnipe = blindTime >= 0.80;

  // Update cumulative score (replace if retrying same round, or sum roundScores)
  game.roundScores[game.round - 1] = Math.max(
    game.roundScores[game.round - 1] || 0,
    totalRoundScore
  );
  game.totalScore = game.roundScores.reduce((acc, v) => acc + v, 0);

  if (game.totalScore > game.bestScore) {
    game.bestScore = game.totalScore;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('blind_radar_shot_best_score', String(game.bestScore));
      }
    } catch (_) {}
  }

  game.lastResult = {
    outcome: 'CLEAR',
    reason: 'TARGET_DESTROYED',
    minMissDistance: 0,
    hitOffsetPx: Math.round(clampedOffset),
    impactRadiusPx,
    hitDistanceM: impactRadiusPx,
    blindTime: Number(blindTime.toFixed(2)),
    distanceScore,
    rangeBonus: distanceScore,
    baseScore,
    blindBonus,
    precisionBonus,
    noPingBonus,
    score: totalRoundScore,
    rank,
    isLongRangeSnipe,
    isDangerClose,
    isBullseye,
    isBlindSnipe
  };
  game.roundResults[game.round - 1] = game.lastResult;

  game.state = 'RESULT_CLEAR';
  game.stateTimer = 0;

  game.effects.hitStopTimer = 0.06;
  game.effects.screenFlashTimer = 0.25;
  game.effects.screenShakeTimer = 0.35;
  game.effects.screenShakeMagnitude = 10;
  spawnHitParticles(game, impactX, impactY);

  if (game.audio) {
    game.audio.playTargetHit(isBullseye);
  }
}

function diagnoseMissReason(game) {
  if (!game.cpaInfo) return 'SHOT MISSED — 目標軌道から外れました';
  if (game.cpaInfo.decoyHit) {
    return 'DECOY HIT — 偽反応デコイを撃ち抜きました（本物は別軌道）';
  }
  const mainTgt = game.targets.find(t => t.id === 'main');
  if (!mainTgt) return 'SHOT MISSED';

  // Determine whether shot passed behind or ahead of enemy movement vector
  const log = game.trajectoryLog.main;
  if (log && log.length >= 2) {
    const p1 = log[Math.max(0, log.length - 2)];
    const p2 = log[log.length - 1];
    const vx = p2.x - p1.x;
    const vy = p2.y - p1.y;
    const dx = game.cpaInfo.bulletX - game.cpaInfo.enemyX;
    const dy = game.cpaInfo.bulletY - game.cpaInfo.enemyY;
    const dot = vx * dx + vy * dy;
    if (dot < -2) {
      return 'UNDER-LEAD (偏差不足 — 敵はさらに先へ移動していました)';
    } else if (dot > 2) {
      return 'OVER-LEAD (偏差過多 — 敵の到達より先に弾が通過しました)';
    }
  }
  return 'EVADED BY TURN (敵の旋回・変針により射線から離脱)';
}

function finalizeRoundFail(game, reason) {
  logTrajectoryPoint(game, true);
  for (const tgt of game.targets) {
    tgt.visibleDirectly = true;
  }
  if (game.bullet) {
    game.bullet.active = false;
  }

  let minMissDistance = null;
  if (reason !== 'CORE_BREACHED' && game.cpaInfo) {
    minMissDistance = Math.max(
      1,
      Math.round(game.cpaInfo.minCenterDist - CONSTANTS.R_HIT)
    );
  }

  const diagnosis =
    reason === 'CORE_BREACHED'
      ? 'NO SHOT FIRED — CORE BREACHED (敵のコア突入を許しました)'
      : diagnoseMissReason(game);

  game.lastResult = {
    outcome: 'FAIL',
    reason, // 'SHOT_MISSED' | 'DECOY_BAITED' | 'CORE_BREACHED'
    minMissDistance,
    hitOffsetPx: null,
    score: 0,
    rank: 'F',
    diagnosis
  };

  game.state = 'RESULT_FAIL';
  game.stateTimer = 0;

  if (reason === 'CORE_BREACHED') {
    game.effects.screenShakeTimer = 0.40;
    game.effects.screenShakeMagnitude = 12;
    game.effects.shockwaves.push({
      x: 0,
      y: 0,
      r: 8,
      maxR: 130,
      color: '#FF2244',
      alpha: 1.0,
      speed: 260
    });
    if (game.audio) game.audio.playPlayerHit();
  } else {
    if (game.audio) game.audio.playTargetMiss();
  }
}

function updateVisualEffects(game, dt) {
  const fx = game.effects;
  if (fx.muzzleFlashTimer > 0) fx.muzzleFlashTimer = Math.max(0, fx.muzzleFlashTimer - dt);
  if (fx.screenFlashTimer > 0) fx.screenFlashTimer = Math.max(0, fx.screenFlashTimer - dt);
  if (fx.screenShakeTimer > 0) fx.screenShakeTimer = Math.max(0, fx.screenShakeTimer - dt);
  if (fx.hitStopTimer > 0) fx.hitStopTimer = Math.max(0, fx.hitStopTimer - dt);
  if (fx.northPassHighlightTimer > 0) {
    fx.northPassHighlightTimer = Math.max(0, fx.northPassHighlightTimer - dt);
  }
  if (fx.pulseBannerTimer > 0) fx.pulseBannerTimer = Math.max(0, fx.pulseBannerTimer - dt);

  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.15, dt);
    p.vy *= Math.pow(0.15, dt);
    p.life -= dt;
    p.alpha = Math.max(0, p.life / p.maxLife);
    if (p.life <= 0) fx.particles.splice(i, 1);
  }

  for (let i = fx.shockwaves.length - 1; i >= 0; i--) {
    const sw = fx.shockwaves[i];
    sw.r += sw.speed * dt;
    sw.alpha = Math.max(0, 1 - sw.r / sw.maxR);
    if (sw.r >= sw.maxR) fx.shockwaves.splice(i, 1);
  }
}

export function stepGame(game, rawDt) {
  const dt = Math.max(0, Math.min(Number(rawDt) || 0, 0.05));
  if (dt <= 0) return;

  updateVisualEffects(game, dt);
  game.stateTimer += dt;
  if (game.mode === 'ENDLESS' && game.state !== 'TITLE') {
    stepEndless(game, dt);
    return;
  }

  // Title background sweep rotation
  if (game.state === 'TITLE' || game.state === 'ALL_CLEAR') {
    game.sweepAngle = normalizeAngle(game.sweepAngle + CONSTANTS.SWEEP_OMEGA * dt);
    return;
  }

  // Briefing auto-advance after 1.2s
  if (game.state === 'BRIEFING') {
    if (game.stateTimer >= CONSTANTS.BRIEFING_DURATION) {
      game.state = 'PLAYING';
      game.stateTimer = 0;
    }
    return;
  }

  if (game.state !== 'PLAYING' && game.state !== 'SHOT_FLYING') {
    return;
  }

  // Advance round clock & sweep angle
  const prevRoundTime = game.roundTime;
  game.roundTime += dt;

  const sweepPrev = game.sweepAngle;
  const sweepCurr = normalizeAngle(sweepPrev + CONSTANTS.SWEEP_OMEGA * dt);
  game.sweepAngle = sweepCurr;

  // Check if sweep passed North (3*PI/2)
  if (prevRoundTime > 0.05 && isAngleSwept(sweepPrev, sweepCurr, CONSTANTS.SWEEP_INITIAL_ANGLE)) {
    game.effects.northPassHighlightTimer = 0.25;
    if (game.audio) game.audio.playSweepPass();
  }

  // Update targets and check sweep intersections
  for (const tgt of game.targets) {
    if (tgt.destroyed) continue;
    const prevR = tgt.r;
    const prevTheta = tgt.theta;

    const nextPos = computeTargetCoords(
      game.round,
      tgt.id,
      game.roundTime,
      game.theta0,
      game.turnSign
    );
    tgt.x = nextPos.x;
    tgt.y = nextPos.y;
    tgt.r = nextPos.r;
    tgt.theta = nextPos.theta;
    tgt.heading = nextPos.heading;
    tgt.shapeType = nextPos.shapeType;
    tgt.turnSign = game.turnSign;
    tgt.turnDir = nextPos.turnDir;
    tgt.zigzagDir = nextPos.zigzagDir;
    tgt.isBoosted = nextPos.isBoosted;

    // Rotating sweep detection (respects SWEEP_DETECT_COOLDOWN = 0.40s)
    if (
      game.roundTime - tgt.lastSweepDetectAt >= CONSTANTS.SWEEP_DETECT_COOLDOWN &&
      didSweepCrossTarget(sweepPrev, sweepCurr, prevTheta, tgt.theta)
    ) {
      tgt.lastSweepDetectAt = game.roundTime;
      recordBlip(game, tgt, 'sweep');
    }

    // Tactical pulse detection (ignores sweep cooldown!)
    if (game.activePulse && game.activePulse.active && !game.activePulse.detectedIds.has(tgt.id)) {
      const pPrev = game.activePulse.rPrev;
      const pCurr = game.activePulse.rCurr + CONSTANTS.PULSE_SPEED * dt;
      const minTargetR = Math.min(prevR, tgt.r);
      const maxTargetR = Math.max(prevR, tgt.r);
      if (pPrev <= maxTargetR && pCurr >= minTargetR) {
        game.activePulse.detectedIds.add(tgt.id);
        recordBlip(game, tgt, 'pulse');
      }
    }
  }

  // Advance tactical pulse ring
  if (game.activePulse && game.activePulse.active) {
    game.activePulse.rPrev = game.activePulse.rCurr;
    game.activePulse.rCurr += CONSTANTS.PULSE_SPEED * dt;
    if (game.activePulse.rCurr >= CONSTANTS.RADAR_RADIUS) {
      game.activePulse.active = false;
    }
  }

  // Prune expired blips (> BLIP_LIFETIME = 6.0s)
  for (let i = game.blipHistory.length - 1; i >= 0; i--) {
    if (game.roundTime - game.blipHistory[i].detectedAt > CONSTANTS.BLIP_LIFETIME) {
      game.blipHistory.splice(i, 1);
    }
  }

  logTrajectoryPoint(game, false);

  // If SHOT_FLYING, update railgun bullet and perform continuous line-segment hit detection
  if (game.state === 'SHOT_FLYING' && game.bullet && game.bullet.active) {
    const b = game.bullet;
    b.prevX = b.x;
    b.prevY = b.y;
    b.elapsed += dt;
    b.r = Math.min(CONSTANTS.BULLET_MAX_RANGE, CONSTANTS.BULLET_SPEED * b.elapsed);
    b.x = b.r * Math.cos(b.angle);
    b.y = b.r * Math.sin(b.angle);

    // Check decoy collisions in Round 5 / Round 9 / Round 10 (all decoys dissolve with glitch noise, bullet continues!)
    const activeDecoys = game.targets.filter(t => isDecoyTarget(t.id) && !t.destroyed);
    for (const decoyTgt of activeDecoys) {
      const dSegDecoy = distSegmentToPoint(b.prevX, b.prevY, b.x, b.y, decoyTgt.x, decoyTgt.y);
      if (dSegDecoy <= CONSTANTS.R_HIT) {
        decoyTgt.destroyed = true;
        decoyTgt.visibleDirectly = true;
        if (game.cpaInfo) game.cpaInfo.decoyHit = true;
        game.effects.shockwaves.push({
          x: decoyTgt.x,
          y: decoyTgt.y,
          r: 4,
          maxR: 50,
          color: '#22D3EE',
          alpha: 0.9,
          speed: 180
        });
      }
    }

    // Check main target collision
    const mainTgt = game.targets.find(t => t.id === 'main');
    if (mainTgt) {
      const segInfo = segmentToPointDetails(b.prevX, b.prevY, b.x, b.y, mainTgt.x, mainTgt.y);
      if (game.cpaInfo && segInfo.dist < game.cpaInfo.minCenterDist) {
        game.cpaInfo.minCenterDist = segInfo.dist;
        game.cpaInfo.bulletX = segInfo.closestX;
        game.cpaInfo.bulletY = segInfo.closestY;
        game.cpaInfo.enemyX = mainTgt.x;
        game.cpaInfo.enemyY = mainTgt.y;
        game.cpaInfo.enemyAngle = mainTgt.theta;
        game.cpaInfo.time = game.roundTime;
      }

      if (segInfo.dist <= CONSTANTS.R_HIT) {
        finalizeRoundClear(game, segInfo.dist, segInfo.closestX, segInfo.closestY);
        return;
      }
    }

    // Target-Point EMP Detonation (AOE Plasma Burst at designated aim distance firedAimDist)
    if (!b.blastTriggered && b.r >= game.firedAimDist) {
      b.blastTriggered = true;
      const bx = game.firedAimX;
      const by = game.firedAimY;

      game.effects.shockwaves.push(
        {
          x: bx,
          y: by,
          r: 6,
          maxR: CONSTANTS.BLAST_RADIUS,
          color: '#38BDF8',
          alpha: 0.95,
          speed: 220
        },
        {
          x: bx,
          y: by,
          r: 12,
          maxR: CONSTANTS.BLAST_RADIUS * 1.15,
          color: '#00FFAA',
          alpha: 0.65,
          speed: 180
        }
      );

      // Check if main target is inside BLAST_RADIUS (prioritize main target hit!)
      if (mainTgt && !mainTgt.destroyed) {
        const dBlast = Math.hypot(mainTgt.x - bx, mainTgt.y - by);
        if (dBlast <= CONSTANTS.BLAST_RADIUS) {
          if (game.cpaInfo && dBlast < game.cpaInfo.minCenterDist) {
            game.cpaInfo.minCenterDist = dBlast;
            game.cpaInfo.bulletX = bx;
            game.cpaInfo.bulletY = by;
            game.cpaInfo.enemyX = mainTgt.x;
            game.cpaInfo.enemyY = mainTgt.y;
            game.cpaInfo.enemyAngle = mainTgt.theta;
            game.cpaInfo.time = game.roundTime;
          }
          const effectiveOffset = Math.min(
            CONSTANTS.R_HIT,
            dBlast * (CONSTANTS.R_HIT / CONSTANTS.BLAST_RADIUS)
          );
          finalizeRoundClear(game, effectiveOffset, mainTgt.x, mainTgt.y);
          return;
        } else if (game.cpaInfo) {
          const effectiveCenterDist = Math.max(
            CONSTANTS.R_HIT + 1,
            dBlast - (CONSTANTS.BLAST_RADIUS - CONSTANTS.R_HIT)
          );
          if (effectiveCenterDist < game.cpaInfo.minCenterDist) {
            game.cpaInfo.minCenterDist = effectiveCenterDist;
            game.cpaInfo.bulletX = bx;
            game.cpaInfo.bulletY = by;
            game.cpaInfo.enemyX = mainTgt.x;
            game.cpaInfo.enemyY = mainTgt.y;
            game.cpaInfo.enemyAngle = mainTgt.theta;
            game.cpaInfo.time = game.roundTime;
          }
        }
      }

      // Check if any active decoys are inside BLAST_RADIUS
      const remainingDecoys = game.targets.filter(t => isDecoyTarget(t.id) && !t.destroyed);
      for (const decoyTgt of remainingDecoys) {
        const dDecoyBlast = Math.hypot(decoyTgt.x - bx, decoyTgt.y - by);
        if (dDecoyBlast <= CONSTANTS.BLAST_RADIUS) {
          decoyTgt.destroyed = true;
          decoyTgt.visibleDirectly = true;
          if (game.cpaInfo) game.cpaInfo.decoyHit = true;
          game.effects.shockwaves.push({
            x: decoyTgt.x,
            y: decoyTgt.y,
            r: 4,
            maxR: 50,
            color: '#22D3EE',
            alpha: 0.9,
            speed: 180
          });
        }
      }
    }

    // Check if bullet reached outer radar boundary (MISS)
    if (b.r >= CONSTANTS.RADAR_RADIUS) {
      const failReason = game.cpaInfo && game.cpaInfo.decoyHit ? 'DECOY_BAITED' : 'SHOT_MISSED';
      finalizeRoundFail(game, failReason);
      return;
    }
  }

  // Check if main enemy breached the player's core (r <= CORE_HIT_DIST = 34px)
  const mainTgt = game.targets.find(t => t.id === 'main' && !t.destroyed);
  if (mainTgt && mainTgt.r <= CONSTANTS.CORE_HIT_DIST) {
    finalizeRoundFail(game, 'CORE_BREACHED');
  }
}

export function retryCurrentRound(game) {
  if (game.mode === 'ENDLESS') return startEndless(game);
  initRound(game, game.round, undefined, true); // Skip briefing for 0.5s instant retry!
}

export function retryOrNextAction(game, forceImmediate = false) {
  if (game.mode === 'ENDLESS' && game.state !== 'TITLE') {
    if (game.state === 'ENDLESS_RESULT' &&
        (forceImmediate || game.stateTimer >= CONSTANTS.FAIL_INPUT_GUARD)) {
      startEndless(game);
      return true;
    }
    return false;
  }
  if (game.state === 'TITLE') {
    game.totalScore = 0;
    game.roundScores = Array(MAX_ROUNDS).fill(0);
    game.roundResults = Array(MAX_ROUNDS).fill(null);
    initRound(game, 1, undefined, false);
    return true;
  }

  if (game.state === 'BRIEFING') {
    game.state = 'PLAYING';
    game.stateTimer = 0;
    return true;
  }

  if (game.state === 'RESULT_FAIL') {
    if (!forceImmediate && game.stateTimer < CONSTANTS.FAIL_INPUT_GUARD) return false;
    // Direct transition to PLAYING of the same round without BRIEFING!
    initRound(game, game.round, undefined, true);
    return true;
  }

  if (game.state === 'RESULT_CLEAR') {
    if (!forceImmediate && game.stateTimer < CONSTANTS.CLEAR_INPUT_GUARD) return false;
    if (game.round < MAX_ROUNDS) {
      initRound(game, game.round + 1, undefined, false);
    } else {
      game.state = 'ALL_CLEAR';
      game.stateTimer = 0;
      const overallRank = getOverallRank(game.totalScore);
      game.bestRank =
        game.bestRank === 'S' || overallRank === 'S'
          ? 'S'
          : game.bestRank === 'A' || overallRank === 'A'
          ? 'A'
          : overallRank;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('blind_radar_shot_best_rank', game.bestRank);
        }
      } catch (_) {}
    }
    return true;
  }

  if (game.state === 'ALL_CLEAR') {
    game.totalScore = 0;
    game.roundScores = Array(MAX_ROUNDS).fill(0);
    game.roundResults = Array(MAX_ROUNDS).fill(null);
    initRound(game, 1, undefined, false);
    return true;
  }

  return false;
}

export function getOverallRank(totalScore) {
  if (totalScore >= 70000) return 'S';
  if (totalScore >= 50000) return 'A';
  return 'B';
}

// Select only observed, still-live individuals. Never consult true coordinates.
export function selectObservedTarget(game) {
  const seen = new Set();
  let selected = null;
  let best = Infinity;
  for (const b of game.blipHistory) {
    if (seen.has(b.targetId)) continue;
    seen.add(b.targetId);
    if (!game.targets.some(t => t.id === b.targetId && !t.destroyed && !t.breached)) continue;
    const distance = Math.hypot(b.x - game.aimX, b.y - game.aimY);
    if (distance < best) { best = distance; selected = b; }
  }
  return selected;
}

export function startEndless(game, initialAngle = undefined, skipGuard = false) {
  // Reuse reset plumbing, not campaign movement or victory processing.
  initRound(game, 1, initialAngle, true);
  game.mode = 'ENDLESS';
  setAimAngle(game, -Math.PI / 4, 220);
  game.targets = [];
  game.lastResult = null;
  game.totalScore = 0;
  game.roundScores = Array(MAX_ROUNDS).fill(0);
  game.roundResults = Array(MAX_ROUNDS).fill(null);
  game.endless = {
    wave: 0, hp: ENDLESS_CONFIG.CORE_HP, kills: 0, shots: 0, hitShots: 0,
    nextEnemyId: 1, nextShotId: 1, reloadRemaining: 0,
    spawned: 0, spawnRemaining: 0, waveTime: 0, restRemaining: 0,
    lastEvent: '防衛開始'
  };
  beginEndlessWave(game);
  if (skipGuard) game.stateTimer = ENDLESS_CONFIG.INPUT_GUARD;
  return game;
}

function beginEndlessWave(game) {
  const e = game.endless;
  e.wave++;
  e.spawned = 0;
  e.waveTime = 0;
  e.waveStartedAt = game.roundTime;
  e.slotIds = [];
  e.plan = buildEndlessWavePlan(e.wave);
  e.phase = 'ASSAULT';
  e.waveKills = 0;
  e.waveBreaches = 0;
  e.spawnRemaining = 0;
  game.targets = [];
  game.blipHistory = [];
  game.allBlipsLog = [];
  game.trajectoryLog = {};
  game.bullet = null;
  game.activePulse = null;
  game.tacticalPingRemaining = 1;
  game.state = 'PLAYING';
  game.stateTimer = 0;
  e.lastEvent = `Wave ${e.wave} 開始`;
  while (e.plan.events[e.spawned]?.at === 0) spawnEndlessEnemy(game, e.plan.events[e.spawned]);
  game.audio?.playEndlessPhase?.('ASSAULT');
}

function spawnEndlessEnemy(game, event) {
  const e = game.endless;
  const ordinal = e.nextEnemyId++;
  const theta = normalizeAngle(game.theta0 + event.bearing);
  const { radialSpeed, omega } = endlessMotion(event.kind, 0, event.sign, event.speed);
  const pos = evaluateEndlessPosition(event.kind, 0, theta, event.sign, event.speed);
  const id = `enemy-${ordinal}`;
  e.slotIds.push(id);
  game.targets.push({
    id, isDecoy: event.kind === 'F', kind: event.kind,
    parentId: event.kind === 'F' ? e.slotIds[event.parentIndex] : undefined,
    form: ENDLESS_FORMS[event.kind], shapeType: ENDLESS_FORMS[event.kind].shapeType,
    ...pos, initialTheta: theta, speed: event.speed,
    radialSpeed, omega, heading: normalizeAngle(theta + Math.PI),
    spawnedAt: e.waveStartedAt + event.at, motionSign: event.sign, turnSign: event.sign,
    visibleDirectly: false, destroyed: false, breached: false, lastSweepDetectAt: -999
  });
  e.spawned++;
  e.spawnRemaining = e.plan.events[e.spawned]
    ? Math.max(0, e.plan.events[e.spawned].at - e.waveTime) : 0;
}

function fireEndless(game, angle, dist) {
  const e = game.endless;
  if (game.state !== 'PLAYING' || game.stateTimer < ENDLESS_CONFIG.INPUT_GUARD ||
      game.ammo <= 0 || e.reloadRemaining > 0 || game.bullet?.active) return false;
  if (typeof angle === 'number') setAimAngle(game, angle, dist);
  else if (typeof dist === 'number') setAimAngle(game, game.aimAngle, dist);
  game.ammo = 0;
  e.reloadRemaining = ENDLESS_CONFIG.RELOAD_SECONDS;
  e.shots++;
  game.bullet = {
    id: e.nextShotId++, hitCounted: false, x: 0, y: 0, prevX: 0, prevY: 0,
    r: 0, angle: game.aimAngle, elapsed: 0, active: true, blastTriggered: false,
    aimDist: game.aimDist, aimX: game.aimX, aimY: game.aimY
  };
  game.effects.muzzleFlashTimer = 0.12;
  e.lastEvent = '発射 / 自動装填中';
  game.audio?.playRailgunShot();
  return true;
}

function removeEndlessEnemy(game, target, outcome, bullet = null) {
  if (target.destroyed || target.breached) return;
  const e = game.endless;
  target[outcome === 'kill' ? 'destroyed' : 'breached'] = true;
  game.blipHistory = game.blipHistory.filter(b => b.targetId !== target.id);
  if (target.isDecoy) return; // No HP, real-hit statistics, or kill credit.
  for (const child of game.targets.filter(t => t.parentId === target.id)) {
    child.destroyed = true;
    game.blipHistory = game.blipHistory.filter(b => b.targetId !== child.id);
  }
  if (outcome === 'kill') {
    e.kills++;
    e.waveKills++;
    if (!bullet.hitCounted) { bullet.hitCounted = true; e.hitShots++; }
    e.lastEvent = `${target.id} 撃破`;
    spawnHitParticles(game, target.x, target.y);
    game.audio?.playTargetHit();
  } else {
    e.waveBreaches++;
    e.hp = Math.max(0, e.hp - 1);
    e.lastEvent = `${target.id} 突破 / コア -1`;
    game.audio?.playPlayerHit();
  }
  game.effects.shockwaves.push({
    x: target.x, y: target.y, r: 4, maxR: 50, speed: 180,
    alpha: 0.9, color: outcome === 'kill' ? '#00FFAA' : '#FF3355'
  });
}

function stepEndless(game, dt) {
  // Bound relative collision chords and split at exact scheduled/burst boundaries.
  // This also prevents a newborn from being advanced for time before its birth.
  let remaining = dt;
  while (remaining > 1e-10 && game.state !== 'ENDLESS_RESULT') {
    const e = game.endless;
    let slice = Math.min(remaining, 1/240);
    if (game.state === 'WAVE_REST') slice = Math.min(slice, e.restRemaining);
    else {
      const next = e.plan.events[e.spawned]?.at;
      if (next > e.waveTime + 1e-9) slice = Math.min(slice, next-e.waveTime);
      if (e.phase === 'ASSAULT' && e.plan.assaultEndsAt > e.waveTime + 1e-9)
        slice = Math.min(slice, e.plan.assaultEndsAt-e.waveTime);
      const b=game.bullet;
      if (b?.active && !b.blastTriggered && b.aimDist/CONSTANTS.BULLET_SPEED > b.elapsed+1e-9)
        slice=Math.min(slice,b.aimDist/CONSTANTS.BULLET_SPEED-b.elapsed);
    }
    if (slice <= 1e-10) break;
    stepEndlessSlice(game, slice);
    remaining -= slice;
  }
}

function stepEndlessSlice(game, dt) {
  const e = game.endless;
  if (!e || game.state === 'ENDLESS_RESULT') return;
  e.reloadRemaining = Math.max(0, e.reloadRemaining - dt);
  if (e.reloadRemaining <= 1e-9) { e.reloadRemaining = 0; game.ammo = 1; }
  game.roundTime += dt;
  if (game.state === 'WAVE_REST') {
    e.restRemaining = Math.max(0, e.restRemaining - dt);
    if (e.restRemaining <= 1e-9) beginEndlessWave(game);
    return;
  }
  if (game.state !== 'PLAYING') return;
  e.waveTime += dt;
  e.spawnRemaining = Math.max(0, e.spawnRemaining - dt);
  const sweepPrev = game.sweepAngle;
  game.sweepAngle = normalizeAngle(sweepPrev + CONSTANTS.SWEEP_OMEGA * dt);
  const live = () => game.targets.filter(t => !t.destroyed && !t.breached);

  for (const t of live()) {
    t.prevX = t.x; t.prevY = t.y;
    const prevTheta = t.theta;
    const prevR = t.r;
    if (t.motionSign !== undefined) {
      const age = game.roundTime-t.spawnedAt;
      Object.assign(t, evaluateEndlessPosition(t.kind, age, t.initialTheta, t.motionSign, t.speed),
        endlessMotion(t.kind, age, t.motionSign, t.speed));
      t.isBoosted = (t.kind === 'B' && age >= 6) || (t.kind === 'P' && age >= 5);
      const period=t.kind === 'H' ? 2.2 : 3.6;
      t.turnDir = t.motionSign*(Math.floor(age/period)%2 ? -1 : 1);
      t.zigzagDir=t.turnDir;
    } else {
      // Stationary / constant-velocity fixtures and public legacy motion overrides.
      t.r = Math.max(0, t.r - t.radialSpeed * dt);
      t.theta = normalizeAngle(t.theta + t.omega * dt);
      t.x = t.r * Math.cos(t.theta); t.y = t.r * Math.sin(t.theta);
    }
    t.heading = normalizeAngle(Math.atan2(t.y - t.prevY, t.x - t.prevX));
    if (game.roundTime - t.lastSweepDetectAt >= CONSTANTS.SWEEP_DETECT_COOLDOWN &&
        didSweepCrossTarget(sweepPrev, game.sweepAngle, prevTheta, t.theta)) {
      t.lastSweepDetectAt = game.roundTime;
      recordBlip(game, t);
    }
    const pulse = game.activePulse;
    if (pulse?.active && !pulse.detectedIds.has(t.id) &&
        pulse.rCurr <= prevR && pulse.rCurr + CONSTANTS.PULSE_SPEED * dt >= t.r) {
      pulse.detectedIds.add(t.id);
      recordBlip(game, t, 'pulse');
    }
  }
  if (game.activePulse?.active) {
    game.activePulse.rPrev = game.activePulse.rCurr;
    game.activePulse.rCurr += CONSTANTS.PULSE_SPEED * dt;
    if (game.activePulse.rCurr >= CONSTANTS.RADAR_RADIUS) game.activePulse.active = false;
  }

  const b = game.bullet;
  if (b?.active) {
    b.prevX = b.x; b.prevY = b.y;
    b.elapsed += dt;
    // Preserve the existing railgun: one aim-point blast, slug continues to max range.
    b.r = Math.min(CONSTANTS.BULLET_MAX_RANGE, CONSTANTS.BULLET_SPEED * b.elapsed);
    b.x = b.r * Math.cos(b.angle); b.y = b.r * Math.sin(b.angle);
    for (const t of live()) {
      // Relative swept segment also accounts for enemy motion.
      if (distSegmentToPoint(b.prevX - t.prevX, b.prevY - t.prevY,
                            b.x - t.x, b.y - t.y, 0, 0) <= CONSTANTS.R_HIT) {
        removeEndlessEnemy(game, t, 'kill', b);
      }
    }
    if (b.r + 1e-8 >= b.aimDist && !b.blastTriggered) {
      b.blastTriggered = true;
      game.effects.shockwaves.push({
        x: b.aimX, y: b.aimY, r: 6, maxR: CONSTANTS.BLAST_RADIUS,
        color: '#38BDF8', alpha: 0.95, speed: 220
      });
      for (const t of live()) {
        if (Math.hypot(t.x - b.aimX, t.y - b.aimY) <= CONSTANTS.BLAST_RADIUS) {
          removeEndlessEnemy(game, t, 'kill', b);
        }
      }
    }
    if (b.r + 1e-8 >= CONSTANTS.BULLET_MAX_RANGE) {
      b.active = false;
      if (!b.hitCounted) e.lastEvent = '命中なし / 自動装填中';
    }
  }
  // Collision resolution precedes breach; each individual can resolve only once.
  for (const t of live()) {
    if (!t.isDecoy && t.r <= ENDLESS_CONFIG.CORE_HIT_DIST + 1e-8) removeEndlessEnemy(game, t, 'breach');
  }
  game.targets = live();
  game.blipHistory = game.blipHistory.filter(b => game.roundTime - b.detectedAt <= CONSTANTS.BLIP_LIFETIME);
  game.allBlipsLog = game.blipHistory.map(b => ({ ...b })); // Bounded endless memory.
  if (e.hp === 0) {
    game.state = 'ENDLESS_RESULT';
    game.stateTimer = 0;
    game.lastResult = Object.freeze({
      kills: e.kills, wave: e.wave, shots: e.shots, hitShots: e.hitShots,
      accuracy: e.shots ? 100 * e.hitShots / e.shots : null
    });
    game.bullet = null;
    game.activePulse = null;
    return;
  }
  // Process every due event even if all preceding enemies remain alive.
  // The entire score is <=8 enemies, so no capacity gate/backlog is needed.
  while (e.spawned < e.plan.events.length &&
         e.waveTime + 1e-9 >= e.plan.events[e.spawned].at) {
    spawnEndlessEnemy(game, e.plan.events[e.spawned]);
  }
  e.spawnRemaining = e.plan.events[e.spawned]
    ? Math.max(0, e.plan.events[e.spawned].at - e.waveTime) : 0;
  if (e.phase === 'ASSAULT' && e.waveTime + 1e-9 >= e.plan.assaultEndsAt) {
    e.phase = 'CLEANUP';
    e.lastEvent = '増援終了 / 残敵の観測を継続';
    game.audio?.playEndlessPhase?.('CLEANUP');
  }
  if (e.phase === 'CLEANUP' && game.targets.length === 0 &&
      !game.bullet?.active && !game.activePulse?.active) {
    game.state = 'WAVE_REST';
    game.stateTimer = 0;
    e.restRemaining = ENDLESS_CONFIG.REST_SECONDS;
    e.phase = 'REST';
    e.lastEvent = '安全確保 / 新規反応なし';
    game.audio?.playEndlessPhase?.('REST');
  }
}

export function returnToTitle(game) {
  const audio = game.audio;
  const fresh = createGameState(audio);
  Object.assign(game, fresh);
  return game;
}
