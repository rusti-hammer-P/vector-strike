// Main Application Controller & Test Hook Binder for BLIND RADAR SHOT
// Exposes window.__GAME_STATE__ and window.__GAME_TEST__ exactly per plan.md Section 9.1

import { SoundEngine } from './audio.js';
import {
  CONSTANTS,
  MAX_ROUNDS,
  ROUND_DEFS,
  normalizeAngle,
  createGameState,
  initRound,
  stepGame,
  setAimFromCoords,
  setAimAngle,
  fireRailgun,
  triggerTacticalPing,
  retryCurrentRound,
  retryOrNextAction,
  getOverallRank,
  ENDLESS_CONFIG, startEndless, returnToTitle, selectObservedTarget
} from './engine.js';
import { RadarRenderer } from './renderer.js';

const audio = new SoundEngine();
const game = createGameState(audio);
const canvas = typeof document !== 'undefined' ? document.getElementById('radar-canvas') : null;
const renderer = new RadarRenderer(canvas);
const FIRST_RUN_GUIDE_KEY = 'vector_strike_first_run_guide_seen';
const MIN_VIEWPORT_WIDTH = 1504;
const MIN_VIEWPORT_HEIGHT = 784;

// Keyboard state for continuous fine-tuning of aim
const keysDown = new Set();
let inputBlockedUntil = 0;
const viewportDimensions = () => ({
  width: window.visualViewport?.width ?? window.innerWidth,
  height: window.visualViewport?.height ?? window.innerHeight
});
const viewportIsSupported = () =>
  typeof window.innerWidth !== 'number' ||
  (viewportDimensions().width >= MIN_VIEWPORT_WIDTH &&
    viewportDimensions().height >= MIN_VIEWPORT_HEIGHT);
const inputReady = () => performance.now() >= inputBlockedUntil && viewportIsSupported();
function protectTransition(previous) {
  document.activeElement?.blur?.();
  if (previous !== game.state) inputBlockedUntil = performance.now() + 250;
}

function el(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

function setText(id, text) {
  const node = el(id);
  if (node && node.textContent !== String(text)) {
    node.textContent = String(text);
  }
}

function updateViewportRequirement() {
  const warning = el('viewport-warning');
  if (!warning || typeof window.innerWidth !== 'number' || typeof window.innerHeight !== 'number') {
    return;
  }
  const { width, height } = viewportDimensions();
  const isTooSmall =
    width < MIN_VIEWPORT_WIDTH || height < MIN_VIEWPORT_HEIGHT;
  warning.classList.toggle('hidden', !isTooSmall);
  warning.setAttribute('aria-hidden', String(!isTooSmall));
}

export function syncHudAndOverlays() {
  const roundDef = ROUND_DEFS[game.round - 1] || ROUND_DEFS[0];
  const isOverdrive = game.round >= 6;
  const waveTag = isOverdrive ? '[OVERDRIVE]' : '[WAVE 1]';

  // Left HUD Panel: Round & Target Telemetry
  setText(
    'hud-round-num',
    `ROUND ${String(game.round).padStart(2, '0')} / ${MAX_ROUNDS} ${waveTag}`
  );
  const roundNumEl = el('hud-round-num');
  if (roundNumEl) {
    roundNumEl.className = isOverdrive ? 'round-num overdrive-round' : 'round-num';
  }
  setText('hud-round-name', roundDef.codeName);
  setText('hud-round-desc', roundDef.desc);

  const latestMainBlip = game.blipHistory.find(b => b.targetId === 'main');

  if (latestMainBlip) {
    const blindAge = Math.max(0, game.roundTime - latestMainBlip.detectedAt);
    setText('hud-last-ping', `${blindAge.toFixed(2)}秒前`);
    setText('hud-est-dist', `${Math.round(latestMainBlip.r)} m`);
    const isCrit = latestMainBlip.r <= CONSTANTS.DANGER_RADIUS;
    setText('hud-threat', isCrit ? '危険域' : '追跡中');
    const threatEl = el('hud-threat');
    if (threatEl) {
      threatEl.className = isCrit ? 'telemetry-val danger-text' : 'telemetry-val safe-text';
    }
  } else {
    setText('hud-last-ping', '探索中');
    setText('hud-est-dist', '--- m');
    setText('hud-threat', '未検知');
    const threatEl = el('hud-threat');
    if (threatEl) threatEl.className = 'telemetry-val';
  }

  // Right HUD Panel: Weapon, Tactical Ping, Cursor Telemetry
  const railgunEl = el('hud-railgun-status');
  if (railgunEl) {
    if (game.ammo > 0) {
      railgunEl.textContent = '装填済み [1/1]';
      railgunEl.className = 'status-pill ready';
    } else {
      railgunEl.textContent = '発射済み [0/1]';
      railgunEl.className = 'status-pill depleted';
    }
  }

  const pingEl = el('hud-ping-status');
  if (pingEl) {
    if (game.tacticalPingRemaining > 0) {
      pingEl.textContent = '使用可能 [1/1]';
      pingEl.className = 'status-pill ping-ready';
    } else {
      pingEl.textContent = '使用済み [0/1]';
      pingEl.className = 'status-pill depleted';
    }
  }

  const compassDeg = (
    ((normalizeAngle(game.aimAngle + Math.PI / 2) * 180) / Math.PI) %
    360
  ).toFixed(1);
  const etaSec = (game.aimDist / CONSTANTS.BULLET_SPEED).toFixed(2);
  setText('hud-cursor-azm', `${compassDeg.padStart(5, '0')}°`);
  setText('hud-cursor-rng', `${Math.round(game.aimDist)} m`);
  setText('hud-cursor-tti', `${etaSec} s`);

  // Sound mute button
  const muteBtn = el('btn-mute');
  if (muteBtn) {
    muteBtn.textContent = audio.muted ? 'SOUND: OFF (M)' : 'SOUND: ON (M)';
  }

  // Overlays visibility
  const titleModal = el('title-overlay');
  const briefingBanner = el('briefing-overlay');
  const resultBanner = el('result-overlay');
  const allClearModal = el('all-clear-overlay');

  if (titleModal) titleModal.classList.toggle('hidden', game.state !== 'TITLE');
  if (briefingBanner) {
    briefingBanner.classList.toggle('hidden', game.state !== 'BRIEFING');
    if (game.state === 'BRIEFING') {
      setText(
        'briefing-title',
        `ROUND ${game.round} / ${MAX_ROUNDS} : ${roundDef.codeName}`
      );
      setText('briefing-sub', roundDef.desc);
    }
  }

  if (resultBanner) {
    const showResult = game.state === 'RESULT_CLEAR' || game.state === 'RESULT_FAIL';
    resultBanner.classList.toggle('hidden', !showResult);
    if (showResult && game.lastResult) {
      const res = game.lastResult;
      resultBanner.className =
        res.outcome === 'CLEAR' ? 'result-banner clear-theme' : 'result-banner fail-theme';

      if (res.outcome === 'CLEAR') {
        const rangeTag = res.isLongRangeSnipe
          ? ' // LONG-RANGE SNIPE!'
          : res.isDangerClose
          ? ' // DANGER CLOSE PENALTY'
          : '';
        setText(
          'result-headline',
          `TARGET DESTROYED // RANK ${res.rank} (+${res.score.toLocaleString()} pts)${rangeTag}`
        );
        const distM = res.impactRadiusPx ?? res.hitDistanceM ?? 0;
        const distScore = res.distanceScore ?? res.rangeBonus ?? res.baseScore ?? 0;
        setText(
          'result-detail',
          `命中距離: ${distM}m${res.isLongRangeSnipe ? ' [LONG-RANGE SNIPE!]' : res.isDangerClose ? ' [DANGER CLOSE PENALTY]' : ''} | ズレ: ${res.hitOffsetPx}px | 暗闇経過: ${res.blindTime}s (Range +${distScore} / Blind +${res.blindBonus} / Precision +${res.precisionBonus} / No-Ping +${res.noPingBonus})`
        );
        const nextBtn = el('btn-result-next');
        if (nextBtn) {
          nextBtn.textContent =
            game.round < MAX_ROUNDS
              ? 'NEXT TARGET [CLICK / SPACE / ENTER]'
              : 'FINAL REPORT [CLICK / SPACE / ENTER]';
        }
      } else {
        const missBadge =
          res.minMissDistance !== null ? ` — MISS BY ${res.minMissDistance} px` : '';
        setText('result-headline', `OPERATION FAILED : ${res.reason}${missBadge}`);
        setText('result-detail', res.diagnosis || '');
        const nextBtn = el('btn-result-next');
        if (nextBtn) {
          nextBtn.textContent = 'INSTANT RETRY [CLICK / SPACE / R]';
        }
      }
    }
  }

  if (allClearModal) {
    allClearModal.classList.toggle('hidden', game.state !== 'ALL_CLEAR');
    if (game.state === 'ALL_CLEAR') {
      const overallRank = getOverallRank(game.totalScore);
      setText('allclear-score', `${game.totalScore.toLocaleString()} pts`);
      setText('allclear-rank', `OVERALL RANK : ${overallRank}`);
      const breakdownEl = el('allclear-breakdown');
      if (breakdownEl) {
        breakdownEl.innerHTML = ROUND_DEFS.map((r, i) => {
          const rr = game.roundResults[i];
          const sc = game.roundScores[i] || 0;
          const rk = rr ? rr.rank : '-';
          const distStr =
            rr && rr.impactRadiusPx !== undefined ? `${rr.impactRadiusPx}m` : '-';
          return `<div class="summary-row"><span>R${r.round} ${r.codeName}</span><span>${distStr} | RANK ${rk} | ${sc.toLocaleString()} pts</span></div>`;
        }).join('');
      }
    }
  }
  const endless = game.mode === 'ENDLESS';
  el('endless-hud')?.classList.toggle('hidden', !endless);
  el('endless-result-overlay')?.classList.toggle('hidden', game.state !== 'ENDLESS_RESULT');
  setText('endless-description', `コア${ENDLESS_CONFIG.CORE_HP} / 装填${ENDLESS_CONFIG.RELOAD_SECONDS.toFixed(1)}秒 / 各Waveパルス1回。予定攻勢は撃破を待たず進行。増援終了後も残敵に注意。安全確保後${ENDLESS_CONFIG.REST_SECONDS.toFixed(1)}秒休息。共通敵の折線・旋回・加速・切返しを観測。長槍のランスIIIは優先射撃。偽像は輪郭で識別、パルスでFAKE確定。`);
  if (endless) {
    const e = game.endless;
    const selected = selectObservedTarget(game);
    setText('hud-round-num', `ENDLESS // WAVE ${e.wave}`);
    if (roundNumEl) roundNumEl.className = 'round-num';
    el('endless-hud')?.setAttribute?.('data-phase', e.phase);
    setText('hud-round-name', game.state === 'ENDLESS_RESULT' ? '防衛終了'
      : e.phase === 'REST' ? '安全休息 / 新規敵なし'
      : e.phase === 'CLEANUP' ? (game.targets.length ? '増援終了 / 残敵あり' : '増援終了 / 判定待ち') : '予定攻勢 / 進行中');
    setText('hud-round-desc', selected?.form
      ? `${selected.form.name} 観測 / ${e.lastEvent}`
      : e.lastEvent);
    setText('hud-core', `コア ${e.hp} / ${ENDLESS_CONFIG.CORE_HP}`);
    setText('hud-wave-progress', `出現 ${e.spawned}/${e.plan.events.length} · 残敵 ${game.targets.length}`);
    setText('hud-wave-timing', e.phase === 'REST' ? `静穏維持 → 次Wave ${e.restRemaining.toFixed(1)}秒`
      : e.phase === 'CLEANUP' ? (game.targets.length ? '新規反応なし / 全残敵の処理を' : '弾・パルスの収束待ち')
      : `攻勢終了まで ${Math.max(0, e.plan.assaultEndsAt - e.waveTime).toFixed(1)}秒`
        + (e.spawned < e.plan.events.length ? ` / 次 ${e.spawnRemaining.toFixed(1)}秒` : ' / 締めの余韻'));
    setText('hud-last-ping', selected ? `${(game.roundTime - selected.detectedAt).toFixed(2)}秒前` : e.phase === 'REST' ? '静穏' : '探索中');
    setText('hud-est-dist', selected ? `${Math.round(selected.r)} m` : '--- m');
    setText('hud-threat', selected ? `${selected.targetId}${selected.r <= CONSTANTS.DANGER_RADIUS ? ' 危険域' : ''}` : e.phase === 'REST' ? '安全確保' : '未検知');
    if (railgunEl) railgunEl.textContent = e.reloadRemaining > 0 ? `装填中 ${e.reloadRemaining.toFixed(1)} s` : '装填済み [1/1]';
    if (pingEl && game.state === 'WAVE_REST') pingEl.textContent = '休止中 / 使用不可';
    const pingButton = el('btn-trigger-ping');
    if (pingButton) pingButton.disabled = game.state !== 'PLAYING' || game.tacticalPingRemaining === 0;
    if (game.state === 'ENDLESS_RESULT') {
      const r = game.lastResult;
      setText('endless-result-detail', `撃破 ${r.kills} · 到達Wave ${r.wave} · 命中率 ${r.accuracy === null ? '—' : r.accuracy.toFixed(1) + '%'} (${r.hitShots}/${r.shots}発)`);
    }
  } else if (el('btn-trigger-ping')) {
    el('btn-trigger-ping').disabled = false;
  }
}

function setupInputHandlers() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  updateViewportRequirement();
  window.addEventListener('resize', updateViewportRequirement);

  const firstRunGuide = el('first-run-guide');
  const dismissGuide = el('btn-dismiss-guide');
  if (firstRunGuide) {
    let guideSeen = false;
    try {
      guideSeen = localStorage.getItem(FIRST_RUN_GUIDE_KEY) === 'true';
    } catch (error) {
      console.warn('Could not read the first-run guide preference; showing the guide this visit.', error);
    }
    firstRunGuide.classList.toggle('hidden', guideSeen);
  }

  const markGuideSeen = () => {
    if (firstRunGuide) firstRunGuide.classList.add('hidden');
    try {
      localStorage.setItem(FIRST_RUN_GUIDE_KEY, 'true');
    } catch (error) {
      console.warn('Could not save the first-run guide preference.', error);
    }
  };
  if (dismissGuide) dismissGuide.addEventListener('click', markGuideSeen);

  // Canvas mouse aim & firing / tactical pulse
  if (canvas) {
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const sx = (e.clientX - rect.left) * scaleX;
      const sy = (e.clientY - rect.top) * scaleY;
      const logicX = sx - renderer.cx;
      const logicY = sy - renderer.cy;
      setAimFromCoords(game, logicX, logicY);
    });

    canvas.addEventListener('mousedown', e => {
      if (!inputReady()) return;
      const previous = game.state;
      audio.ensureContext();
      if (e.button === 2) {
        e.preventDefault();
        if (game.state === 'PLAYING') {
          triggerTacticalPing(game);
          document.activeElement?.blur?.();
          syncHudAndOverlays();
        }
        return;
      }

      if (e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const scaleX = canvas.width / rect.width;
          const scaleY = canvas.height / rect.height;
          const sx = (e.clientX - rect.left) * scaleX;
          const sy = (e.clientY - rect.top) * scaleY;
          setAimFromCoords(game, sx - renderer.cx, sy - renderer.cy);
        }

        if (game.state === 'PLAYING') {
          fireRailgun(game);
          syncHudAndOverlays();
        } else if (
          game.state === 'BRIEFING' ||
          game.state === 'RESULT_CLEAR' ||
          game.state === 'RESULT_FAIL'
        ) {
          retryOrNextAction(game, false);
          protectTransition(previous);
          syncHudAndOverlays();
        }
      }
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  // UI Buttons
  const startBtn = el('btn-start-operation');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (!inputReady()) return;
      const previous = game.state;
      audio.ensureContext();
      markGuideSeen();
      retryOrNextAction(game, true);
      protectTransition(previous);
      syncHudAndOverlays();
    });
  }
  const bindAction = (id, action) => el(id)?.addEventListener('click', () => {
    if (!inputReady()) return;
    const previous = game.state;
    audio.ensureContext();
    markGuideSeen();
    action();
    protectTransition(previous);
    syncHudAndOverlays();
  });
  bindAction('btn-start-endless', () => startEndless(game));
  bindAction('btn-endless-retry', () => startEndless(game));
  bindAction('btn-endless-title', () => returnToTitle(game));
  bindAction('btn-mode-title', () => returnToTitle(game));

  // Round quick-select buttons on title overlay
  const roundSelectBtns = document.querySelectorAll('[data-start-round]');
  roundSelectBtns.forEach(btn => {
    btn.addEventListener('click', e => {
      if (!inputReady()) return;
      const previous = game.state;
      e.stopPropagation();
      audio.ensureContext();
      markGuideSeen();
      const r = Number(btn.getAttribute('data-start-round')) || 1;
      game.totalScore = 0;
      game.roundScores = Array(MAX_ROUNDS).fill(0);
      game.roundResults = Array(MAX_ROUNDS).fill(null);
      initRound(game, r, undefined, false);
      protectTransition(previous);
      syncHudAndOverlays();
    });
  });

  const pingBtn = el('btn-trigger-ping');
  if (pingBtn) {
    pingBtn.addEventListener('click', () => {
      if (!inputReady()) return;
      audio.ensureContext();
      triggerTacticalPing(game);
      syncHudAndOverlays();
    });
  }

  const retryBtn = el('btn-quick-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (!inputReady()) return;
      audio.ensureContext();
      retryCurrentRound(game);
      document.activeElement?.blur?.();
      inputBlockedUntil = performance.now() + 250;
      syncHudAndOverlays();
    });
  }

  const resultNextBtn = el('btn-result-next');
  if (resultNextBtn) {
    resultNextBtn.addEventListener('click', () => {
      if (!inputReady()) return;
      const previous = game.state;
      audio.ensureContext();
      retryOrNextAction(game, true);
      protectTransition(previous);
      syncHudAndOverlays();
    });
  }

  const resultRetryBtn = el('btn-result-retry');
  if (resultRetryBtn) {
    resultRetryBtn.addEventListener('click', () => {
      if (!inputReady()) return;
      audio.ensureContext();
      retryCurrentRound(game);
      document.activeElement?.blur?.();
      inputBlockedUntil = performance.now() + 250;
      syncHudAndOverlays();
    });
  }

  const playAgainBtn = el('btn-play-again');
  if (playAgainBtn) {
    playAgainBtn.addEventListener('click', () => {
      if (!inputReady()) return;
      const previous = game.state;
      audio.ensureContext();
      retryOrNextAction(game, true);
      protectTransition(previous);
      syncHudAndOverlays();
    });
  }

  const backTitleBtn = el('btn-back-title');
  if (backTitleBtn) {
    backTitleBtn.addEventListener('click', () => {
      if (!inputReady()) return;
      returnToTitle(game);
      inputBlockedUntil = performance.now() + 250;
      syncHudAndOverlays();
    });
  }

  const muteBtn = el('btn-mute');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      audio.toggleMute();
      document.activeElement?.blur?.();
      syncHudAndOverlays();
    });
  }

  // Global keyboard shortcuts
  window.addEventListener('keydown', e => {
    const actionKey = [' ', 'Enter', 'Shift', 'e', 'E', 'r', 'R', 't', 'T', 'm', 'M'].includes(e.key);
    if (actionKey) e.preventDefault();
    const held = keysDown.has(e.key);
    keysDown.add(e.key);
    if (actionKey && (e.repeat || held || !inputReady())) return;
    // Keyboard activation of a focused UI button has exactly one owner.
    if ((e.key === ' ' || e.key === 'Enter') && e.target?.tagName === 'BUTTON') {
      e.target.click();
      return;
    }
    const previous = game.state;

    if (e.key === 'm' || e.key === 'M') {
      audio.toggleMute();
      syncHudAndOverlays();
      protectTransition(previous);
      return;
    }

    if (e.key === 'r' || e.key === 'R') {
      if (game.state === 'ALL_CLEAR' || game.state === 'TITLE') {
        if (game.state === 'TITLE') markGuideSeen();
        retryOrNextAction(game, true);
      } else {
        retryCurrentRound(game);
      }
      syncHudAndOverlays();
      inputBlockedUntil = performance.now() + 250;
      return;
    }

    if (e.key === 't' || e.key === 'T') {
      if (game.state !== 'TITLE') {
        returnToTitle(game);
        protectTransition(previous);
        syncHudAndOverlays();
      }
      return;
    }

    if (e.key === 'Shift' || e.key === 'e' || e.key === 'E') {
      if (game.state === 'PLAYING') {
        triggerTacticalPing(game);
        syncHudAndOverlays();
      }
      return;
    }

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      audio.ensureContext();
      if (game.state === 'PLAYING') {
        fireRailgun(game);
      } else {
        if (game.state === 'TITLE') markGuideSeen();
        retryOrNextAction(game, false);
      }
      syncHudAndOverlays();
      protectTransition(previous);
    }
  });

  window.addEventListener('keyup', e => {
    keysDown.delete(e.key);
  });
  window.addEventListener('blur', () => keysDown.clear());
}

function updateKeyboardAim(dt) {
  if (!viewportIsSupported()) return;
  if (game.state !== 'PLAYING' && game.state !== 'BRIEFING') return;
  const fine = keysDown.has('Control');
  const angularSpeed = fine ? 0.35 : 1.2;
  const radialSpeed = fine ? 60 : 180;
  let dir = 0;
  if (keysDown.has('ArrowLeft') || keysDown.has('a') || keysDown.has('A')) dir -= 1;
  if (keysDown.has('ArrowRight') || keysDown.has('d') || keysDown.has('D')) dir += 1;
  let rDir = 0;
  if (keysDown.has('ArrowUp') || keysDown.has('w') || keysDown.has('W')) rDir += 1;
  if (keysDown.has('ArrowDown') || keysDown.has('s') || keysDown.has('S')) rDir -= 1;
  if (dir !== 0 || rDir !== 0) {
    setAimAngle(
      game,
      game.aimAngle + dir * angularSpeed * dt,
      game.aimDist + rDir * radialSpeed * dt
    );
  }
}

// Expose window.__GAME_STATE__ and window.__GAME_TEST__ per plan.md Section 9.1
if (typeof window !== 'undefined') {
  window.__GAME_STATE__ = game;
  window.__GAME_TEST__ = {
    startRound(roundNumber = 1, seedOrInitialAngle = 0.25 * Math.PI) {
      inputBlockedUntil = 0;
      initRound(game, roundNumber, seedOrInitialAngle, true);
      syncHudAndOverlays();
      renderer.render(game);
      return game;
    },
    startEndless(initialAngle = 0, skipGuard = true) {
      inputBlockedUntil = 0;
      startEndless(game, initialAngle, skipGuard);
      syncHudAndOverlays();
      renderer.render(game);
      return game;
    },
    step(dtSeconds = 0.02, stepsCount = 1) {
      const count = Math.max(1, Math.floor(stepsCount));
      for (let i = 0; i < count; i++) {
        stepGame(game, dtSeconds);
      }
      syncHudAndOverlays();
      renderer.render(game);
      return game;
    },
    aimAndFire(angleRad, distPx = undefined) {
      setAimAngle(game, angleRad, distPx);
      const ok = fireRailgun(game, angleRad, distPx);
      syncHudAndOverlays();
      renderer.render(game);
      return ok;
    },
    triggerTacticalPing() {
      const ok = triggerTacticalPing(game);
      syncHudAndOverlays();
      renderer.render(game);
      return ok;
    },
    retryOrNext() {
      const ok = retryOrNextAction(game, true);
      syncHudAndOverlays();
      renderer.render(game);
      return ok;
    }
  };
}

setupInputHandlers();
syncHudAndOverlays();
renderer.render(game);

// Main animation loop
let lastFrameTime = typeof performance !== 'undefined' ? performance.now() : 0;
function onAnimationFrame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  updateKeyboardAim(dt);
  stepGame(game, dt);
  syncHudAndOverlays();
  renderer.render(game);

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(onAnimationFrame);
  }
}

if (typeof requestAnimationFrame === 'function') {
  requestAnimationFrame(onAnimationFrame);
}
