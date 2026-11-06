// Automated Acceptance Test Suite (AT-01 ~ AT-15 + Real Headless Browser E2E)
// for BLIND RADAR SHOT (projects/blind-radar-shot)

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  CONSTANTS,
  TWO_PI,
  normalizeAngle,
  createGameState,
  initRound,
  stepGame,
  computeTargetCoords,
  computeDynamicLeadPrediction
} from '../src/engine.js';

// Set up minimal DOM environment so importing ../src/main.js binds window.__GAME_STATE__ and window.__GAME_TEST__
const elements = new Map();
function getOrCreateEl(id) {
  if (!elements.has(id)) {
    const listeners = {};
    const classSet = new Set();
    elements.set(id, {
      id,
      width: 960,
      height: 720,
      textContent: '',
      innerHTML: '',
      className: '',
      style: {},
      classList: {
        add: c => classSet.add(c),
        remove: c => classSet.delete(c),
        toggle: (c, force) => {
          if (force === undefined) {
            if (classSet.has(c)) classSet.delete(c);
            else classSet.add(c);
          } else if (force) classSet.add(c);
          else classSet.delete(c);
        },
        contains: c => classSet.has(c)
      },
      addEventListener: (ev, cb) => {
        listeners[ev] = listeners[ev] || [];
        listeners[ev].push(cb);
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }),
      getContext: () => ({
        save: () => {},
        restore: () => {},
        clearRect: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        translate: () => {},
        rotate: () => {},
        beginPath: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        quadraticCurveTo: () => {},
        bezierCurveTo: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
        setLineDash: () => {},
        fillText: () => {},
        measureText: t => ({ width: String(t).length * 7 }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createLinearGradient: () => ({ addColorStop: () => {} })
      })
    });
  }
  return elements.get(id);
}

globalThis.window = {
  addEventListener: () => {}
};
globalThis.document = {
  getElementById: id => getOrCreateEl(id),
  querySelectorAll: () => []
};
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {}
};
globalThis.requestAnimationFrame = () => {};

await import('../src/main.js');

const STATE = globalThis.window.__GAME_STATE__;
const TEST = globalThis.window.__GAME_TEST__;

// Helper: Solve exact intercept angle phi_hit for a target in Round r at current roundTime
function solveInterceptAngle(round, targetId, currentTime, theta0, turnSign = 1) {
  // Iterate 8 steps of fixed-point time-of-flight t_hit = r(currentTime + t_hit) / BULLET_SPEED
  let tFly = 0.25;
  for (let i = 0; i < 10; i++) {
    const pos = computeTargetCoords(round, targetId, currentTime + tFly, theta0, turnSign);
    tFly = pos.r / CONSTANTS.BULLET_SPEED;
  }
  const hitPos = computeTargetCoords(round, targetId, currentTime + tFly, theta0, turnSign);
  return Math.atan2(hitPos.y, hitPos.x);
}

let passed = 0;
function runTest(id, title, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${id}: ${title}`);
    passed++;
  } catch (err) {
    console.error(`❌ [FAIL] ${id}: ${title}`);
    console.error(err);
    throw new Error('Real browser acceptance failed (see output above)');
  }
}

// ============================================================================
// AT-01: 初期起動とTITLE状態検証
// ============================================================================
runTest('AT-01', '初期起動とTITLE状態検証（window.__GAME_STATE__ 公開・エラー0件）', () => {
  assert.ok(STATE, 'window.__GAME_STATE__ must be defined');
  assert.ok(TEST, 'window.__GAME_TEST__ must be defined');
  assert.equal(STATE.state, 'TITLE', 'Initial state must be TITLE');
  assert.equal(STATE.round, 1);
  assert.equal(STATE.ammo, 1);
  assert.equal(STATE.tacticalPingRemaining, 1);
});

// ============================================================================
// AT-02: 通常時の敵不可視とスイープ検知・ブリップ生成
// ============================================================================
runTest('AT-02', '通常時の敵不可視とスイープ検知・ブリップ生成', () => {
  TEST.startRound(1, 0.25 * Math.PI);
  assert.equal(STATE.state, 'PLAYING');
  assert.equal(STATE.blipHistory.length, 0, 'At t=0 blipHistory must be empty');
  assert.equal(STATE.targets.length, 1);
  assert.equal(
    STATE.targets[0].visibleDirectly,
    false,
    'Enemy visibleDirectly flag must be false during normal play'
  );

  // Advance 2.0 seconds (1 full sweep revolution = 100 steps of 0.02s)
  TEST.step(0.02, 100);
  assert.ok(STATE.blipHistory.length >= 1, 'Sweep must detect enemy at least once in 2.0s');

  const latestBlip = STATE.blipHistory[0];
  const expectedPos = computeTargetCoords(
    1,
    'main',
    latestBlip.detectedAt,
    STATE.theta0,
    STATE.turnSign
  );
  assert.ok(
    Math.abs(latestBlip.x - expectedPos.x) < 1e-4 &&
      Math.abs(latestBlip.y - expectedPos.y) < 1e-4,
    `Blip coords (${latestBlip.x}, ${latestBlip.y}) must match enemy coords at detectedAt (${expectedPos.x}, ${expectedPos.y})`
  );
  assert.equal(latestBlip.source, 'sweep');
  assert.equal(STATE.targets[0].visibleDirectly, false);
});

// ============================================================================
// AT-03: 角度跨ぎ（2π → 0）でのスイープ検知漏れ防止
// ============================================================================
runTest('AT-03', '角度跨ぎ（2π → 0）でのスイープ検知漏れ防止', () => {
  // Set enemy initial angle right after 0 rad (0.01 rad)
  TEST.startRound(1, 0.01);
  // Position sweep just before 2π (2π - 0.1 rad)
  STATE.sweepAngle = TWO_PI - 0.1;
  assert.equal(STATE.blipHistory.length, 0);

  // Advance with dt = 0.04s across the 2π -> 0 boundary
  TEST.step(0.04, 6);
  assert.equal(
    STATE.blipHistory.length,
    1,
    'Sweep crossing 2π -> 0 boundary must detect enemy at ~0.01 rad without skipping'
  );
});

// ============================================================================
// AT-04: 戦術パルス（1回限定）の発動と回数制限
// ============================================================================
runTest('AT-04', '戦術パルス（1回限定）の発動と回数制限', () => {
  TEST.startRound(1, 0.8 * Math.PI);
  assert.equal(STATE.tacticalPingRemaining, 1);

  const firstCall = TEST.triggerTacticalPing();
  assert.equal(firstCall, true, '1st tactical ping must succeed');
  assert.equal(STATE.tacticalPingRemaining, 0, 'tacticalPingRemaining must become 0');

  // Step 0.30s (15 steps * 0.02s) so pulse expands past 360px
  TEST.step(0.02, 15);
  const pulseBlips = STATE.blipHistory.filter(b => b.source === 'pulse');
  assert.equal(pulseBlips.length, 1, 'Pulse must generate a blip with source === "pulse"');

  // 2nd call in the same round must be ignored
  const secondCall = TEST.triggerTacticalPing();
  assert.equal(secondCall, false, '2nd tactical ping in same round must be ignored');
  assert.equal(STATE.tacticalPingRemaining, 0);
});

// ============================================================================
// AT-05: 1発必殺ルールと命中撃破（RESULT_CLEAR）
// ============================================================================
runTest('AT-05', '1発必殺ルールと命中撃破（RESULT_CLEAR）', () => {
  TEST.startRound(1, 0.25 * Math.PI);
  // Let sweep detect target and build >0.8s blind time for bonus verification
  TEST.step(0.02, 80); // t = 1.6s

  const phiHit = solveInterceptAngle(1, 'main', STATE.roundTime, STATE.theta0, STATE.turnSign);
  const fired = TEST.aimAndFire(phiHit);
  assert.equal(fired, true);
  assert.equal(STATE.ammo, 0, 'Ammo must become 0 immediately after firing');
  assert.equal(STATE.state, 'SHOT_FLYING', 'State must transition to SHOT_FLYING upon firing');

  // Attempting to fire a 2nd shot must fail
  assert.equal(TEST.aimAndFire(phiHit), false, 'Cannot fire a second shot');

  // Advance bullet flight (up to 30 frames of 0.016s = 0.48s)
  TEST.step(0.016, 30);
  assert.equal(STATE.state, 'RESULT_CLEAR', 'State must transition to RESULT_CLEAR on hit');
  assert.ok(STATE.lastResult, 'lastResult must be populated');
  assert.equal(STATE.lastResult.outcome, 'CLEAR');
  assert.ok(
    STATE.lastResult.score >= 3000,
    `Expected score >= 3000, got ${STATE.lastResult.score}`
  );
  assert.equal(STATE.targets[0].visibleDirectly, true, 'Enemy must be unveiled on RESULT_CLEAR');
});

// ============================================================================
// AT-06: 外れ確定判定と minMissDistance 算出（RESULT_FAIL: SHOT_MISSED）
// ============================================================================
runTest('AT-06', '外れ確定判定と minMissDistance 算出（RESULT_FAIL: SHOT_MISSED）', () => {
  const theta0 = 0.25 * Math.PI;
  TEST.startRound(1, theta0);
  const phiMiss = theta0 + Math.PI; // Opposite direction
  TEST.aimAndFire(phiMiss);
  assert.equal(STATE.state, 'SHOT_FLYING');

  // Advance 0.50s (25 steps * 0.02s) so bullet reaches r >= 360px
  TEST.step(0.02, 25);
  assert.equal(STATE.state, 'RESULT_FAIL');
  assert.equal(STATE.lastResult.outcome, 'FAIL');
  assert.equal(STATE.lastResult.reason, 'SHOT_MISSED');
  assert.equal(typeof STATE.lastResult.minMissDistance, 'number');
  assert.ok(
    STATE.lastResult.minMissDistance > 0,
    `Expected minMissDistance > 0, got ${STATE.lastResult.minMissDistance}`
  );
  assert.equal(STATE.targets[0].visibleDirectly, true, 'Enemy must be unveiled on RESULT_FAIL');
});

// ============================================================================
// AT-07: 自機コア被弾による敗北判定（RESULT_FAIL: CORE_BREACHED）
// ============================================================================
runTest('AT-07', '自機コア被弾による敗北判定（RESULT_FAIL: CORE_BREACHED）', () => {
  TEST.startRound(1, 0.25 * Math.PI);
  // Step 15.0 seconds without firing (300 steps * 0.05s)
  TEST.step(0.05, 300);
  assert.equal(STATE.state, 'RESULT_FAIL');
  assert.equal(STATE.lastResult.outcome, 'FAIL');
  assert.equal(STATE.lastResult.reason, 'CORE_BREACHED');
  assert.equal(STATE.lastResult.minMissDistance, null);
  assert.ok(
    STATE.targets[0].r <= CONSTANTS.CORE_HIT_DIST,
    `Expected enemy r <= ${CONSTANTS.CORE_HIT_DIST}, got ${STATE.targets[0].r}`
  );
});

// ============================================================================
// AT-08: 全5ラウンドの軌道アルゴリズムとRound 5デコイ識別
// ============================================================================
runTest('AT-08', '全5ラウンドの軌道アルゴリズムとRound 5デコイ識別・デコイ被弾敗北検証', () => {
  for (let r = 1; r <= 5; r++) {
    TEST.startRound(r, 0.5);
    const startR = STATE.targets[0].r;
    TEST.step(0.05, 80); // 4.0s
    const afterR = STATE.targets[0].r;
    assert.ok(afterR < startR, `Round ${r} target must approach origin (${startR} -> ${afterR})`);

    if (r === 3) {
      // Round 3: Verify Phase 2 boost acceleration after 6.0s (r <= 230px)
      const rAt4s = STATE.targets[0].r; // 350 - 20*4 = 270
      TEST.step(0.05, 40); // t = 6.0s -> r = 230
      const rAt6s = STATE.targets[0].r;
      TEST.step(0.05, 40); // t = 8.0s -> r = 230 - 42*2 = 146
      const rAt8s = STATE.targets[0].r;
      const speedPhase1 = (rAt4s - rAt6s) / 2.0;
      const speedPhase2 = (rAt6s - rAt8s) / 2.0;
      assert.ok(
        speedPhase2 > speedPhase1 * 1.9,
        `Round 3 must boost radial speed in Phase 2 (${speedPhase1} -> ${speedPhase2})`
      );
    }

    if (r === 4) {
      // Round 4: Verify angular velocity sign reversal across t = 3.6s
      TEST.startRound(4, 0.5);
      TEST.step(0.05, 70); // t = 3.5s (approaching first turn at 3.6s)
      const thetaNearTurn = STATE.targets[0].theta;
      assert.ok(thetaNearTurn > 0.5, 'Round 4 moves clockwise for t < 3.6s');
      TEST.step(0.05, 70); // t = 7.0s (after turn at 3.6s, moving counter-clockwise)
      const thetaAfterTurn = STATE.targets[0].theta;
      assert.ok(
        thetaAfterTurn < thetaNearTurn,
        `Round 4 must reverse angular direction after t=3.6s (${thetaNearTurn} -> ${thetaAfterTurn})`
      );
    }

    if (r === 5) {
      // Round 5: Verify 2 targets (main + decoy) and Tactical Ping decoy identification
      TEST.startRound(5, 0.5);
      assert.equal(STATE.targets.length, 2, 'Round 5 must have 2 targets (main and decoy)');
      assert.equal(STATE.targets[0].id, 'main');
      assert.equal(STATE.targets[1].id, 'decoy');

      TEST.triggerTacticalPing();
      TEST.step(0.02, 20); // 0.40s so tactical ping passes both targets

      const decoyPulseBlip = STATE.blipHistory.find(
        b => b.targetId === 'decoy' && b.source === 'pulse'
      );
      const mainPulseBlip = STATE.blipHistory.find(
        b => b.targetId === 'main' && b.source === 'pulse'
      );
      assert.ok(decoyPulseBlip, 'Tactical ping must detect decoy');
      assert.equal(
        decoyPulseBlip.isDecoyEcho,
        true,
        'Decoy blip from tactical ping must set isDecoyEcho === true'
      );
      assert.ok(mainPulseBlip, 'Tactical ping must detect main target');
      assert.equal(
        mainPulseBlip.isDecoyEcho,
        false,
        'Main target blip must have isDecoyEcho === false'
      );

      // Verify shooting the decoy results in RESULT_FAIL (DECOY_BAITED) when bullet reaches outer ring
      const phiDecoy = solveInterceptAngle(
        5,
        'decoy',
        STATE.roundTime,
        STATE.theta0,
        STATE.turnSign
      );
      TEST.aimAndFire(phiDecoy);
      TEST.step(0.016, 30);
      assert.equal(STATE.state, 'RESULT_FAIL', 'Shooting decoy must fail once bullet exits radar');
      assert.equal(STATE.lastResult.reason, 'DECOY_BAITED');
    }
  }
});

// ============================================================================
// AT-09: 0.5秒即時リトライ導線の検証
// ============================================================================
runTest('AT-09', '0.5秒即時リトライ導線の検証（RESULT_FAILからBRIEFINGなしでPLAYINGへ即復帰）', () => {
  TEST.startRound(3, 0.4);
  TEST.aimAndFire(0.4 + Math.PI); // Miss intentionally
  TEST.step(0.02, 25);
  assert.equal(STATE.state, 'RESULT_FAIL');
  assert.equal(STATE.round, 3);

  // Wait 0.25s and trigger retryOrNext()
  TEST.step(0.05, 5);
  TEST.retryOrNext();

  assert.equal(
    STATE.state,
    'PLAYING',
    'Retry from RESULT_FAIL must bypass BRIEFING and enter PLAYING immediately'
  );
  assert.equal(STATE.round, 3, 'Must retry the same round');
  assert.equal(STATE.ammo, 1, 'Ammo must be restored to 1');
  assert.equal(STATE.tacticalPingRemaining, 1, 'Tactical Ping must be restored to 1');
  assert.equal(STATE.blipHistory.length, 0, 'Blip history must be cleared');
});

// ============================================================================
// AT-10: 全10ラウンドクリアから ALL_CLEAR 遷移の完結検証
// ============================================================================
runTest('AT-10', '全10ラウンド（WAVE 1 + WAVE 2 OVERDRIVE）クリアから ALL_CLEAR 遷移の完結検証', () => {
  STATE.totalScore = 0;
  STATE.roundScores = Array(10).fill(0);
  STATE.roundResults = Array(10).fill(null);

  for (let r = 1; r <= 10; r++) {
    TEST.startRound(r, 0.3 * r);
    // Advance 1.0s so sweep detects target, then snipe main target accurately
    TEST.step(0.02, 50);
    const phiHit = solveInterceptAngle(r, 'main', STATE.roundTime, STATE.theta0, STATE.turnSign);
    TEST.aimAndFire(phiHit);
    TEST.step(0.016, 30);

    assert.equal(STATE.state, 'RESULT_CLEAR', `Round ${r} must be cleared`);
    assert.equal(STATE.lastResult.outcome, 'CLEAR');

    // Proceed to next round (or ALL_CLEAR after Round 10)
    TEST.step(0.05, 6);
    TEST.retryOrNext();

    if (r < 10) {
      assert.equal(STATE.round, r + 1, `Should advance to Round ${r + 1}`);
      // Skip briefing into PLAYING
      if (STATE.state === 'BRIEFING') {
        TEST.retryOrNext();
      }
      assert.equal(STATE.state, 'PLAYING');
    } else {
      assert.equal(STATE.state, 'ALL_CLEAR', 'After Round 10 clear, state must be ALL_CLEAR');
    }
  }

  assert.ok(
    STATE.totalScore >= 50000,
    `Expected totalScore >= 50000 after clearing all 10 rounds at long range, got ${STATE.totalScore}`
  );
});

// ============================================================================
// AT-11: 全5ラウンドの敵固有形状 (shapeType)・進行方向 (heading)・機動状態フラグ＆Canvas描画検証
// ============================================================================
runTest(
  'AT-11',
  '全5ラウンドの敵固有形状 (shapeType)・進行方向 (heading)・機動状態フラグ＆Canvas描画検証',
  () => {
    const expectedShapes = {
      1: 'delta_lance',
      2: 'crescent_wing',
      3: 'twin_thruster',
      4: 'sidewinder',
      5: 'stealth_dreadnought'
    };

    for (let r = 1; r <= 5; r++) {
      TEST.startRound(r, 0.35);
      const mainTgt = STATE.targets.find(t => t.id === 'main');
      assert.ok(mainTgt, `Round ${r} must have main target`);
      assert.equal(
        mainTgt.shapeType,
        expectedShapes[r],
        `Round ${r} main target shapeType must be ${expectedShapes[r]}`
      );
      assert.equal(typeof mainTgt.heading, 'number');
      assert.ok(!Number.isNaN(mainTgt.heading), `Round ${r} heading must be a valid angle`);

      if (r === 5) {
        const decoyTgt = STATE.targets.find(t => t.id === 'decoy');
        assert.ok(decoyTgt, 'Round 5 must have decoy target');
        assert.equal(
          decoyTgt.shapeType,
          'hologram_prism',
          'Round 5 decoy target shapeType must be hologram_prism'
        );
        assert.equal(typeof decoyTgt.heading, 'number');
      }

      // Step 4.2s to generate multiple sweep blips (B_0, B_-1, ...) and verify blip metadata
      TEST.step(0.03, 140);
      assert.ok(STATE.blipHistory.length >= 2, `Round ${r} must generate multiple blips`);
      for (const b of STATE.blipHistory) {
        const expType = b.targetId === 'decoy' ? 'hologram_prism' : expectedShapes[r];
        assert.equal(b.shapeType, expType, `Blip shapeType must be ${expType}`);
        assert.equal(typeof b.heading, 'number', 'Blip must record heading angle');
        assert.equal(typeof b.turnDir, 'number', 'Blip must record turnDir');
      }

      if (r === 3) {
        // At t = 4.2s (r > 230), isBoosted must be false; after t = 6.2s (r <= 230), isBoosted must be true
        assert.equal(mainTgt.isBoosted, false, 'Round 3 mainTgt.isBoosted must be false before 6.0s');
        TEST.step(0.05, 45); // advance +2.25s -> t = 6.45s (r <= 230)
        assert.equal(mainTgt.isBoosted, true, 'Round 3 mainTgt.isBoosted must be true when r <= 230');
        TEST.triggerTacticalPing();
        TEST.step(0.02, 15);
        const boostedBlip = STATE.blipHistory.find(b => b.targetId === 'main');
        assert.equal(boostedBlip.isBoosted, true, 'Round 3 blip after r <= 230 must have isBoosted === true');
      }

      if (r === 4) {
        // Verify turnDir flips sign across 3.6s period
        TEST.startRound(4, 0.4);
        const dirPhase0 = STATE.targets[0].turnDir;
        TEST.step(0.05, 80); // t = 4.0s (phase 1: 3.6s..7.2s)
        const dirPhase1 = STATE.targets[0].turnDir;
        assert.equal(
          dirPhase1,
          -dirPhase0,
          `Round 4 turnDir must flip sign after 3.6s (${dirPhase0} -> ${dirPhase1})`
        );
      }

      // Trigger Unveil state (RESULT_CLEAR) to verify drawTruthUnveil / drawEnemySilhouette executes cleanly
      const phiHit = solveInterceptAngle(r, 'main', STATE.roundTime, STATE.theta0, STATE.turnSign);
      TEST.aimAndFire(phiHit);
      TEST.step(0.016, 30);
      assert.equal(STATE.state, 'RESULT_CLEAR');
    }
  }
);

// ============================================================================
// AT-12: Round 6〜10（WAVE 2）の軌道アルゴリズムと複数デコイ検証
// ============================================================================
runTest(
  'AT-12',
  'Round 6〜10（WAVE 2: OVERDRIVE）の軌道アルゴリズム・複数デコイ構成・戦術パルス一斉看破検証',
  () => {
    // 1. Round 6 (HYPER LANCE): Dogleg turn near r=190px (t1 ~ 5.85s)
    TEST.startRound(6, 0.4);
    assert.equal(STATE.targets.length, 1);
    assert.equal(STATE.targets[0].shapeType, 'delta_lance');
    TEST.step(0.05, 60); // t = 3.0s (Phase 1 before r=190px turn)
    const headingPhase1 = STATE.targets[0].heading;
    TEST.step(0.05, 80); // t = 7.0s (Phase 2 after r=190px turn)
    const headingPhase2 = STATE.targets[0].heading;
    const headingDiff = Math.abs(normalizeAngle(headingPhase2 - headingPhase1));
    assert.ok(
      headingDiff > 0.3 && headingDiff < TWO_PI - 0.3,
      `Round 6 heading must turn sharply after r=190px (phase1=${headingPhase1}, phase2=${headingPhase2})`
    );

    // 2. Round 7 (ELLIPTIC VORTEX): Accelerating angular velocity over time
    TEST.startRound(7, 0.4);
    assert.equal(STATE.targets[0].shapeType, 'crescent_wing');
    const theta0_r7 = STATE.targets[0].theta;
    TEST.step(0.05, 40); // t = 2.0s
    const theta2_r7 = STATE.targets[0].theta;
    TEST.step(0.05, 40); // t = 4.0s
    const theta4_r7 = STATE.targets[0].theta;
    const dThetaEarly = normalizeAngle(theta2_r7 - theta0_r7);
    const dThetaLate = normalizeAngle(theta4_r7 - theta2_r7);
    assert.ok(
      dThetaLate > dThetaEarly,
      `Round 7 angular displacement must accelerate (${dThetaEarly} -> ${dThetaLate})`
    );

    // 3. Round 8 (PHANTOM BLINK): Boost + lateral phase shift at t >= 5.0s (r <= 240px)
    TEST.startRound(8, 0.4);
    assert.equal(STATE.targets[0].shapeType, 'twin_thruster');
    TEST.step(0.05, 96); // t = 4.8s (just before boost at 5.0s)
    assert.equal(STATE.targets[0].isBoosted, false);
    const rBefore8 = STATE.targets[0].r;
    const thetaBefore8 = STATE.targets[0].theta;
    TEST.step(0.05, 12); // t = 5.4s (after boost & 0.25s phase blink)
    assert.equal(STATE.targets[0].isBoosted, true, 'Round 8 isBoosted must be true for t >= 5.0s');
    const rAfter8 = STATE.targets[0].r;
    const thetaAfter8 = STATE.targets[0].theta;
    assert.ok(rBefore8 - rAfter8 > 22.0, `Round 8 radial drop must accelerate after boost`);
    assert.ok(
      normalizeAngle(thetaAfter8 - thetaBefore8) > 0.40,
      `Round 8 must perform lateral phase blink shift across t=5.0s`
    );

    // 4. Round 9 (VIPER SLALOM): 2.2s period high-freq slalom + 1 decoy
    TEST.startRound(9, 0.4);
    assert.equal(STATE.targets.length, 2, 'Round 9 must have 2 targets (main and decoy)');
    assert.equal(STATE.targets[0].shapeType, 'sidewinder');
    assert.equal(STATE.targets[1].shapeType, 'hologram_prism');
    const turnDir0 = STATE.targets[0].turnDir;
    TEST.step(0.05, 50); // t = 2.5s (past 2.2s period)
    const turnDir1 = STATE.targets[0].turnDir;
    assert.equal(turnDir1, -turnDir0, 'Round 9 turnDir must reverse after 2.2s period');

    // 5. Round 10 (OMEGA MIRAGE): 4 targets (main + decoy, decoy2, decoy3) & Tactical Ping exposes all 3 decoys
    TEST.startRound(10, 0.4);
    assert.equal(STATE.targets.length, 4, 'Round 10 must have 4 targets (main + 3 decoys)');
    const ids = STATE.targets.map(t => t.id);
    assert.deepEqual(ids, ['main', 'decoy', 'decoy2', 'decoy3']);
    assert.equal(STATE.targets[0].shapeType, 'stealth_dreadnought');
    assert.equal(STATE.targets[1].shapeType, 'hologram_prism');
    assert.equal(STATE.targets[2].shapeType, 'hologram_prism');
    assert.equal(STATE.targets[3].shapeType, 'hologram_prism');

    TEST.triggerTacticalPing();
    TEST.step(0.02, 20); // 0.40s so pulse wave sweeps across all 4 targets
    for (const dId of ['decoy', 'decoy2', 'decoy3']) {
      const dBlip = STATE.blipHistory.find(b => b.targetId === dId && b.source === 'pulse');
      assert.ok(dBlip, `Tactical Ping in Round 10 must detect ${dId}`);
      assert.equal(
        dBlip.isDecoyEcho,
        true,
        `${dId} pulse blip must have isDecoyEcho === true`
      );
    }
    const mBlip = STATE.blipHistory.find(b => b.targetId === 'main' && b.source === 'pulse');
    assert.ok(mBlip, 'Tactical Ping in Round 10 must detect main target');
    assert.equal(mBlip.isDecoyEcho, false, 'Main target pulse blip must have isDecoyEcho === false');
  }
);

// ============================================================================
// AT-13: 距離比例スコア（遠距離高スコア／接近時大幅減点）の検証
// ============================================================================
runTest(
  'AT-13',
  '距離比例スコア検証（遠距離狙撃 ＞ 中距離迎撃 ＞ 危険域接近ペナルティ の単調減少性）',
  () => {
    // Case A: Long-range snipe at t ~ 2.0s (r_impact >= 250px)
    TEST.startRound(1, 0.25 * Math.PI);
    TEST.step(0.02, 100); // t = 2.0s
    const phiA = solveInterceptAngle(1, 'main', STATE.roundTime, STATE.theta0, STATE.turnSign);
    TEST.aimAndFire(phiA);
    TEST.step(0.016, 30);
    assert.equal(STATE.state, 'RESULT_CLEAR');
    const resA = { ...STATE.lastResult };

    // Case B: Mid-range intercept at t ~ 6.0s (r_impact ~ 170px)
    TEST.startRound(1, 0.25 * Math.PI);
    TEST.step(0.02, 300); // t = 6.0s
    const phiB = solveInterceptAngle(1, 'main', STATE.roundTime, STATE.theta0, STATE.turnSign);
    TEST.aimAndFire(phiB);
    TEST.step(0.016, 30);
    assert.equal(STATE.state, 'RESULT_CLEAR');
    const resB = { ...STATE.lastResult };

    // Case C: Danger-close intercept at t ~ 10.0s (r_impact < 120px)
    TEST.startRound(1, 0.25 * Math.PI);
    TEST.step(0.02, 500); // t = 10.0s
    const phiC = solveInterceptAngle(1, 'main', STATE.roundTime, STATE.theta0, STATE.turnSign);
    TEST.aimAndFire(phiC);
    TEST.step(0.016, 30);
    assert.equal(STATE.state, 'RESULT_CLEAR');
    const resC = { ...STATE.lastResult };

    assert.ok(
      resA.impactRadiusPx >= 240 && resA.isLongRangeSnipe === true,
      `Case A must be Long-Range Snipe (impactRadiusPx=${resA.impactRadiusPx}, isLongRangeSnipe=${resA.isLongRangeSnipe})`
    );
    assert.ok(
      resB.impactRadiusPx >= 120 && resB.impactRadiusPx < 240,
      `Case B must be Mid-Range (impactRadiusPx=${resB.impactRadiusPx})`
    );
    assert.ok(
      resC.impactRadiusPx < 120 && resC.isDangerClose === true,
      `Case C must trigger Danger Close Penalty (impactRadiusPx=${resC.impactRadiusPx}, isDangerClose=${resC.isDangerClose})`
    );

    assert.ok(
      resA.distanceScore > resB.distanceScore && resB.distanceScore > resC.distanceScore,
      `distanceScore must strictly decrease as enemy gets closer: A(${resA.distanceScore}) > B(${resB.distanceScore}) > C(${resC.distanceScore})`
    );
    assert.ok(
      resA.score > resB.score && resB.score > resC.score,
      `Total round score must strictly decrease as enemy gets closer: A(${resA.score}) > B(${resB.score}) > C(${resC.score})`
    );
    assert.ok(
      resC.distanceScore <= 1200 && resC.rank === 'B',
      `Danger close hit must cap distanceScore <= 1200 (got ${resC.distanceScore}) and rank === 'B' (got ${resC.rank})`
    );
  }
);

// ============================================================================
// AT-14: 照準地点プラズマ炸裂（EMP AOE）の許容誤差検証とリアルタイム予測マーカー（Lead Ghost）検証
// ============================================================================
runTest(
  'AT-14',
  '照準地点プラズマ炸裂（BLAST_RADIUS=44px）による角度・距離ズレ許容とLead Ghost直感命中検証',
  () => {
    assert.equal(CONSTANTS.R_HIT, 28.0, 'R_HIT must be expanded to 28.0px');
    assert.equal(CONSTANTS.BLAST_RADIUS, 44.0, 'BLAST_RADIUS must be 44.0px');

    // 1. Dynamic Lead Ghost verification: after 2+ blips, shooting directly at Lead Ghost hits in R1 & R2
    for (const r of [1, 2]) {
      TEST.startRound(r, 0.35 * Math.PI);
      // Step 3.4s so 2 sweep blips are recorded and some blind time has elapsed
      TEST.step(0.02, 170);
      const lead = computeDynamicLeadPrediction(STATE, 'main');
      assert.ok(lead, `Round ${r} must produce a Dynamic Lead Prediction after 2 blips`);
      assert.ok(lead.r >= 25 && lead.r <= CONSTANTS.RADAR_RADIUS);
      assert.ok(lead.eta > 0);

      // Human clicks directly on the Lead Ghost ring (lead.angle, lead.r)
      TEST.aimAndFire(lead.angle, lead.r);
      TEST.step(0.016, 30);
      assert.equal(
        STATE.state,
        'RESULT_CLEAR',
        `Round ${r}: Firing at Dynamic Lead Ghost must hit and clear`
      );
    }

    // 2. Angular & Radial Margin verification across all 10 rounds:
    // Even if human aim is off by +5.5 deg (0.096 rad) and +22px in distance, EMP Blast (44px) + R_HIT (28px) hits!
    const angleOffsetRad = (5.5 * Math.PI) / 180;
    const distOffsetPx = 22;

    for (let r = 1; r <= 10; r++) {
      TEST.startRound(r, 0.3 * Math.PI);
      TEST.step(0.02, 100); // t = 2.0s

      // Compute true intercept point, then apply human aiming error (+5.5 deg angle, +22px distance)
      let tFly = 0.25;
      for (let i = 0; i < 10; i++) {
        const pos = computeTargetCoords(r, 'main', STATE.roundTime + tFly, STATE.theta0, STATE.turnSign);
        tFly = pos.r / CONSTANTS.BULLET_SPEED;
      }
      const exactPos = computeTargetCoords(r, 'main', STATE.roundTime + tFly, STATE.theta0, STATE.turnSign);
      const exactAngle = Math.atan2(exactPos.y, exactPos.x);

      TEST.aimAndFire(exactAngle + angleOffsetRad, exactPos.r + distOffsetPx);
      TEST.step(0.016, 30);
      assert.equal(
        STATE.state,
        'RESULT_CLEAR',
        `Round ${r}: Aiming off by +5.5° and +22px must still hit via Target-Point EMP Blast`
      );
    }
  }
);

// ============================================================================
// AT-15: レーダー角度位相による初回検知タイミングの偏り監査
// ============================================================================
runTest('AT-15', '全ラウンド・全旋回方向でレーダー角度位相ごとの初回検知を測定', () => {
  const phaseCount = 32;
  const measurements = [];

  for (let round = 1; round <= 10; round++) {
    const latencies = [];
    for (const turnSign of [1, -1]) {
      for (let phaseIndex = 0; phaseIndex < phaseCount; phaseIndex++) {
        const game = createGameState(null);
        initRound(game, round, 0, true);
        game.turnSign = turnSign;
        game.sweepAngle = normalizeAngle((phaseIndex * TWO_PI) / phaseCount);

        for (let frame = 0; frame < 100; frame++) {
          stepGame(game, 0.02);
          const firstMainBlip = game.allBlipsLog.find(blip => blip.targetId === 'main');
          if (firstMainBlip) {
            latencies.push(firstMainBlip.detectedAt);
            break;
          }
        }
      }
    }

    assert.equal(
      latencies.length,
      phaseCount * 2,
      `Round ${round}: main target should be detected in every sampled phase`
    );
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const mean = latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length;
    assert.ok(max <= 1.8, `Round ${round}: first detection took too long (${max.toFixed(2)}s)`);
    measurements.push(
      `R${round} ${min.toFixed(2)}-${max.toFixed(2)}s (avg ${mean.toFixed(2)}s)`
    );
  }

  console.log(`   初回検知 latency by phase: ${measurements.join(' | ')}`);
});

// ============================================================================
// Real Headless Browser (Playwright / Chromium) & HTTP Server E2E Verification
// ============================================================================
async function runRealBrowserE2E() {
  const port = 18945;
  const projectRoot = new URL('..', import.meta.url).pathname;
  const server = spawn('python3', ['-m', 'http.server', String(port)], {
    cwd: projectRoot,
    stdio: 'ignore'
  });

  try {
    await new Promise(r => setTimeout(r, 350));

    // 1. Verify HTTP server serves all project assets with HTTP 200
    for (const path of ['/index.html', '/style.css', '/src/main.js', '/src/engine.js', '/src/renderer.js', '/src/audio.js']) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(res.status, 200, `Expected HTTP 200 for ${path}`);
    }

    // 2. Find Python interpreter with Playwright or Selenium for real headless Chromium test
    const candidatePythons = [
      '/home/natsuki/work/nas/.venv/bin/python',
      '/home/natsuki/work/linucli/.venv/bin/python',
      'python3'
    ];

    let browserPy = null;
    for (const py of candidatePythons) {
      const probe = spawnSync(py, ['-c', 'import playwright.sync_api'], { stdio: 'ignore' });
      if (probe.status === 0) {
        browserPy = py;
        break;
      }
    }

    if (browserPy) {
      const pyScript = `
import sys
from playwright.sync_api import sync_playwright

url = "http://127.0.0.1:${port}/index.html"
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1504, "height": 784})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(url, wait_until="networkidle")

    # AT-01 in real Chromium
    state = page.evaluate("window.__GAME_STATE__.state")
    assert state == "TITLE", f"Expected TITLE on startup, got {state}"
    guide = page.locator("#first-run-guide")
    assert guide.is_visible(), "First-run guide should appear on a fresh visit"
    page.locator("#btn-dismiss-guide").click()
    assert not guide.is_visible(), "First-run guide should be skippable"
    assert page.evaluate("localStorage.getItem('vector_strike_first_run_guide_seen')") == "true"
    page.reload(wait_until="networkidle")
    assert not page.locator("#first-run-guide").is_visible(), "First-run guide should not reappear"

    # Playfield size is fixed; a smaller viewport shows the warning instead of shrinking the radar.
    box = page.locator("#radar-canvas").bounding_box()
    assert box["width"] == 960 and box["height"] == 720, f"Unexpected playfield size: {box}"
    assert box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= 1504 and box["y"] + box["height"] <= 784
    page.set_viewport_size({"width": 1280, "height": 720})
    warning = page.locator("#viewport-warning")
    page.wait_for_function("!document.querySelector('#viewport-warning').classList.contains('hidden')")
    assert warning.is_visible(), "Unsupported viewport must show a minimum-size warning"
    assert page.locator("#radar-canvas").bounding_box()["width"] == 960, "Radar must not shrink on small viewports"
    page.locator("#btn-start-operation").focus()
    page.keyboard.press("Enter")
    assert page.evaluate("window.__GAME_STATE__.state") == "TITLE", "Keyboard start must be blocked below minimum viewport"
    page.set_viewport_size({"width": 1504, "height": 784})
    page.wait_for_function("document.querySelector('#viewport-warning').classList.contains('hidden')")
    assert not warning.is_visible(), "Warning must disappear when the minimum viewport is restored"

    # Click START OPERATION button in real browser
    page.locator("#btn-start-operation").click()
    state_after_click = page.evaluate("window.__GAME_STATE__.state")
    assert state_after_click in ("BRIEFING", "PLAYING"), f"Unexpected state after start click: {state_after_click}"

    # Test real mouse move + right-click (Tactical Ping) + left-click (Railgun Shot) on canvas
    page.evaluate("window.__GAME_TEST__.startRound(1, 0.25 * Math.PI)")
    page.mouse.move(box["x"] + box["width"] * 0.65, box["y"] + box["height"] * 0.65)
    page.mouse.click(box["x"] + box["width"] * 0.65, box["y"] + box["height"] * 0.65, button="right")
    ping_rem = page.evaluate("window.__GAME_STATE__.tacticalPingRemaining")
    assert ping_rem == 0, f"Right-click on canvas must deploy Tactical Ping, got {ping_rem}"

    page.mouse.click(box["x"] + box["width"] * 0.65, box["y"] + box["height"] * 0.65, button="left")
    ammo_rem = page.evaluate("window.__GAME_STATE__.ammo")
    assert ammo_rem == 0, f"Left-click on canvas must fire Railgun, got {ammo_rem}"

    # Verify all 10 rounds render unique enemy shapes (WAVE 1 + WAVE 2 OVERDRIVE + multi-decoys) in real Chromium Canvas
    shapes_verified = page.evaluate("""() => {
      const shapes = [];
      for (let r = 1; r <= 10; r++) {
        window.__GAME_TEST__.startRound(r, 0.35);
        window.__GAME_TEST__.step(0.04, 150);
        window.__GAME_TEST__.triggerTacticalPing();
        window.__GAME_TEST__.step(0.02, 15);
        const tgt = window.__GAME_STATE__.targets[0];
        const blip = window.__GAME_STATE__.blipHistory[0];
        window.__GAME_TEST__.aimAndFire(0.35 + Math.PI);
        window.__GAME_TEST__.step(0.02, 25);
        shapes.push({
          round: r,
          targetCount: window.__GAME_STATE__.targets.length,
          targetShape: tgt.shapeType,
          blipShape: blip.shapeType,
          heading: tgt.heading
        });
      }
      return shapes;
    }""")
    assert len(shapes_verified) == 10, f"Expected 10 rounds verified, got {shapes_verified}"
    assert shapes_verified[8]["targetCount"] == 2, f"Round 9 must have 2 targets, got {shapes_verified[8]}"
    assert shapes_verified[9]["targetCount"] == 4, f"Round 10 must have 4 targets, got {shapes_verified[9]}"

    assert len(errors) == 0, f"Browser console/page errors: {errors}"
    browser.close()
print("✅ [PASS] E2E-BROWSER: Real Headless Chromium (1504x784) fixed 960x720 playfield, undersized viewport warning, first-run guide, all 10 rounds and mouse/keyboard input verified with 0 errors!")
`;
      const run = spawnSync(browserPy, ['-c', pyScript], { encoding: 'utf8' });
      if (run.status !== 0) {
        console.error(run.stdout);
        console.error(run.stderr);
        process.exit(1);
      }
      console.log(run.stdout.trim());
      passed++;
    }
  } finally {
    if (server.pid && server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
      await new Promise(resolve => server.once('exit', resolve));
    }
  }
}

await runRealBrowserE2E();
console.log(`\n🎉 ALL ${passed} ACCEPTANCE TESTS (AT-01 ~ AT-15 + Real Headless Browser E2E) PASSED!`);
