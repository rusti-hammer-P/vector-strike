// Canvas 2D Tactical Radar Scope Renderer for BLIND RADAR SHOT
// Implements all visual layers from design.md & plan.md:
// - 960x720 logical canvas, radar origin at (480, 360), RADAR_RADIUS = 360px
// - Range rings (90, 180, 270, 360px), Danger ring (120px), Core turret (18px / hit dist 34px)
// - Rotating sweep bar + 55-deg phosphor trailing sector
// - Blip history (B_0..B_-3) with decay, vector dashed lines & future extrapolation hint
// - Round 5 decoy diamond/glitch echo & FAKE label when exposed by Tactical Ping
// - Aiming reticle with distance & ETA/TTI floating telemetry
// - Full Truth Unveil (enemy true trajectory, hitbox circle, bullet path, CPA marker & MISS BY XX px)

import {
  CONSTANTS,
  TWO_PI,
  normalizeAngle,
  isDecoyTarget,
  getTargetShapeType,
  computeDynamicLeadPrediction,
  selectObservedTarget
} from './engine.js';

function quadCurveTo(ctx, cpx, cpy, x, y) {
  if (typeof ctx.quadraticCurveTo === 'function') {
    ctx.quadraticCurveTo(cpx, cpy, x, y);
  } else {
    ctx.lineTo(cpx, cpy);
    ctx.lineTo(x, y);
  }
}

export function getRadarBlipColor({ isDanger, isDecoy, isOverdrive, form }) {
  // Observed silhouettes are hue-neutral; status/confirmed identity colors win.
  if (isDanger && !isDecoy) return '#FF2A55';
  if (isDecoy) return '#22D3EE';
  if (isOverdrive) return '#00F0FF';
  return '#00FFAA';
}

export function fitRadarLabel(ctx, text, x, y, align, width = 960, height = 720, margin = 8) {
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const centerX = width / 2;
  const centerY = height / 2;
  const minX = -centerX + margin;
  const maxX = centerX - margin;
  const left = align === 'right' ? x - textWidth : align === 'center' ? x - textWidth / 2 : x;
  const right = align === 'right' ? x : align === 'center' ? x + textWidth / 2 : x + textWidth;
  if (left < minX) x += minX - left;
  else if (right > maxX) x -= right - maxX;

  const ascent = metrics.actualBoundingBoxAscent || 10;
  const descent = metrics.actualBoundingBoxDescent || 3;
  y = Math.max(-centerY + margin + ascent, Math.min(centerY - margin - descent, y));
  return { x, y, align };
}

export class RadarRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.width = 960;
    this.height = 720;
    this.cx = 480;
    this.cy = 360;
  }

  isDangerActive(game) {
    if (game.state !== 'PLAYING' && game.state !== 'SHOT_FLYING') return false;
    // Check if latest main blip is inside DANGER_RADIUS (120px)
    const latestMainBlip = game.mode === 'ENDLESS'
      ? game.blipHistory.find(b => !b.isDecoy && b.r <= CONSTANTS.DANGER_RADIUS)
      : game.blipHistory.find(b => b.targetId === 'main');
    if (latestMainBlip && latestMainBlip.r <= CONSTANTS.DANGER_RADIUS) return true;
    return false;
  }

  render(game) {
    const ctx = this.ctx;
    if (!ctx) return;

    const w = this.width;
    const h = this.height;
    const cx = this.cx;
    const cy = this.cy;
    const isUnveil = game.state === 'RESULT_CLEAR' || game.state === 'RESULT_FAIL';
    const isDanger = this.isDangerActive(game);

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Outer canvas background
    ctx.fillStyle = isUnveil ? '#060A10' : isDanger ? '#0A0507' : '#04080C';
    ctx.fillRect(0, 0, w, h);

    // Apply screen shake if active
    let shakeX = 0;
    let shakeY = 0;
    if (game.effects.screenShakeTimer > 0) {
      const mag =
        game.effects.screenShakeMagnitude * (game.effects.screenShakeTimer / 0.35);
      shakeX = (Math.random() * 2 - 1) * mag;
      shakeY = (Math.random() * 2 - 1) * mag;
    }

    ctx.translate(cx + shakeX, cy + shakeY);

    // 1. Radar disc interior fill
    this.drawScopeDisc(ctx, game, isDanger, isUnveil);

    // 2. Azimuth grid & range rings
    this.drawGridAndRings(ctx, game, isDanger, isUnveil);

    // 3. Rotating sweep bar & phosphor sector
    const resting = game.mode === 'ENDLESS' && game.state === 'WAVE_REST';
    if (!resting) this.drawSweep(ctx, game, isDanger, isUnveil);

    // 4. Tactical pulse wave
    this.drawTacticalPulse(ctx, game);

    // 5. Truth Unveil layer (true trajectories, CPA error indicator, real enemy hitbox)
    if (isUnveil) {
      this.drawTruthUnveil(ctx, game);
    }

    // 6. Blip history & vector prediction helpers
    this.drawBlipsAndVectors(ctx, game, isDanger, isUnveil);

    // 7. Railgun bullet & trajectory
    this.drawBullet(ctx, game, isUnveil);

    // 8. Shockwaves & shatter particles
    this.drawEffects(ctx, game);

    // 9. Player core turret at (0, 0)
    this.drawCoreTurret(ctx, game, isDanger);

    // 10. Aiming reticle & floating telemetry (DIST + ETA/TTI)
    if (game.state === 'PLAYING' || game.state === 'BRIEFING' || game.state === 'SHOT_FLYING') {
      this.drawReticle(ctx, game, isDanger);
    }

    ctx.restore();

    if (game.mode === 'ENDLESS' && game.state !== 'ENDLESS_RESULT') {
      const e = game.endless;
      ctx.save();
      ctx.fillStyle = resting ? 'rgba(3,14,18,0.62)' : 'rgba(3,14,18,0.9)';
      if (resting) ctx.fillRect(0, 0, w, h);
      // Corner is outside the radar disc: never cover a northern observation.
      ctx.fillRect(8, 8, 274, 48);
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = resting ? '#8BD7C4' : e.phase === 'CLEANUP' ? '#A5CADD' : '#FFC879';
      ctx.fillText(resting ? '安全確保 — 新規反応なし' : e.phase === 'CLEANUP'
        ? `増援終了 — 残敵 ${game.targets.length}` : '予定攻勢 / 進行中', 145, 29);
      ctx.font = '12px monospace';
      ctx.fillText(resting ? `レーダー静穏 / 次Waveまで ${e.restRemaining.toFixed(1)}秒`
        : e.phase === 'ASSAULT' ? '撃破を待たず予定時刻に出現' : game.targets.length ? '観測継続 / 安全確保はまだ' : '弾・パルスの判定収束待ち', 145, 47);
      if (resting) this.drawEndlessClear(ctx, game);
      ctx.restore();
    }

    // Screen flash overlay on impact
    if (game.effects.screenFlashTimer > 0) {
      const alpha = Math.min(0.35, (game.effects.screenFlashTimer / 0.25) * 0.35);
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  drawEndlessClear(ctx, game) {
    const e = game.endless;
    const age = game.stateTimer;
    const settle = Math.min(1, age / 0.65);
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.strokeStyle = '#80DCC7';
    ctx.lineWidth = 2;
    // A short expanding seal resolves into a stable medal, then quiet.
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(0, -30, 82 + 32 * (1 - settle), 0, TWO_PI);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i * TWO_PI / 12;
      ctx.beginPath();
      ctx.moveTo(92 * Math.cos(a), -30 + 92 * Math.sin(a));
      ctx.lineTo(99 * Math.cos(a), -30 + 99 * Math.sin(a));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#BAFFEA';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('WAVE', 0, -55);
    ctx.font = 'bold 48px monospace';
    ctx.fillText(String(e.wave).padStart(2, '0'), 0, -7);
    ctx.font = 'bold 24px monospace';
    ctx.fillText('CLEAR', 0, 115);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#A8CCCA';
    ctx.fillText(`撃破 ${e.waveKills} / 突破 ${e.waveBreaches} — コア ${e.hp}`, 0, 148);
    ctx.fillText('安全確保。次の反応を待つ。', 0, 177);
    ctx.restore();
  }

  drawScopeDisc(ctx, game, isDanger, isUnveil) {
    const R = CONSTANTS.RADAR_RADIUS;
    const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, R);
    if (isUnveil) {
      grad.addColorStop(0, '#0B1924');
      grad.addColorStop(1, '#050C12');
    } else if (isDanger) {
      grad.addColorStop(0, '#1A090D');
      grad.addColorStop(1, '#090406');
    } else {
      grad.addColorStop(0, '#07161C');
      grad.addColorStop(1, '#040B0E');
    }

    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TWO_PI);
    ctx.fillStyle = grad;
    ctx.fill();

    // Pulsing danger zone interior fill (r <= DANGER_RADIUS = 120px)
    const dangerPulse = isDanger
      ? 0.06 + 0.04 * Math.sin(game.roundTime * 10.0)
      : 0.02;
    ctx.beginPath();
    ctx.arc(0, 0, CONSTANTS.DANGER_RADIUS, 0, TWO_PI);
    ctx.fillStyle = `rgba(255, 35, 65, ${dangerPulse.toFixed(3)})`;
    ctx.fill();
  }

  drawGridAndRings(ctx, game, isDanger, isUnveil) {
    const R = CONSTANTS.RADAR_RADIUS;
    const mainRingColor = isUnveil
      ? 'rgba(180, 220, 255, 0.25)'
      : isDanger
      ? 'rgba(255, 140, 0, 0.28)'
      : 'rgba(0, 240, 200, 0.22)';
    const subRingColor = isUnveil
      ? 'rgba(180, 220, 255, 0.10)'
      : isDanger
      ? 'rgba(255, 140, 0, 0.12)'
      : 'rgba(0, 240, 200, 0.09)';

    // Secondary dashed range rings (45, 135, 225, 315 px)
    ctx.save();
    ctx.strokeStyle = subRingColor;
    ctx.lineWidth = 1.0;
    ctx.setLineDash([4, 6]);
    for (const r of CONSTANTS.SUB_RANGE_RINGS) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.restore();

    // Primary range rings (90, 180, 270, 360 px)
    ctx.save();
    ctx.strokeStyle = mainRingColor;
    ctx.fillStyle = isDanger ? 'rgba(255, 165, 60, 0.65)' : 'rgba(0, 240, 200, 0.55)';
    ctx.font = '11px "JetBrains Mono", Consolas, monospace';
    for (const r of CONSTANTS.RANGE_RINGS) {
      ctx.lineWidth = r === R ? 2.2 : 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TWO_PI);
      ctx.stroke();

      // Distance label near North axis
      ctx.fillText(`${r}m`, 6, -r + 13);
    }
    ctx.restore();

    // LONG_SNIPE_RADIUS (240px) boundary guide ring
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([8, 4, 2, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, CONSTANTS.LONG_SNIPE_RADIUS, 0, TWO_PI);
    ctx.stroke();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.48)';
    ctx.font = '9px "JetBrains Mono", Consolas, monospace';
    ctx.fillText('LONG SNIPE 240m', 6, -CONSTANTS.LONG_SNIPE_RADIUS - 4);
    ctx.restore();

    // DANGER_RADIUS (120px) boundary ring
    ctx.save();
    ctx.strokeStyle = isDanger
      ? 'rgba(255, 45, 65, 0.68)'
      : 'rgba(255, 60, 80, 0.28)';
    ctx.lineWidth = isDanger ? 1.6 : 1.1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, CONSTANTS.DANGER_RADIUS, 0, TWO_PI);
    ctx.stroke();
    ctx.fillStyle = isDanger ? 'rgba(255, 70, 90, 0.85)' : 'rgba(255, 60, 80, 0.45)';
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.fillText('DANGER 120m', 6, -CONSTANTS.DANGER_RADIUS - 4);
    ctx.restore();

    // Core breach boundary (CORE_HIT_DIST = 34px)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 80, 100, 0.35)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, CONSTANTS.CORE_HIT_DIST, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();

    // Azimuth radial lines (every 30 deg)
    ctx.save();
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      const isCardinal = deg % 90 === 0;
      const startR = isCardinal ? CONSTANTS.CORE_RADIUS + 4 : 45;
      ctx.strokeStyle = isCardinal
        ? 'rgba(0, 240, 200, 0.20)'
        : 'rgba(0, 240, 200, 0.10)';
      ctx.lineWidth = isCardinal ? 1.0 : 0.8;
      ctx.beginPath();
      ctx.moveTo(startR * Math.cos(rad), startR * Math.sin(rad));
      ctx.lineTo(R * Math.cos(rad), R * Math.sin(rad));
      ctx.stroke();
    }

    // Outer perimeter ticks (every 5 / 15 / 30 deg)
    ctx.strokeStyle = 'rgba(0, 240, 200, 0.45)';
    for (let deg = 0; deg < 360; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const len = deg % 30 === 0 ? 10 : deg % 15 === 0 ? 6 : 3;
      ctx.lineWidth = deg % 30 === 0 ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.moveTo((R - len) * Math.cos(rad), (R - len) * Math.sin(rad));
      ctx.lineTo(R * Math.cos(rad), R * Math.sin(rad));
      ctx.stroke();
    }

    // Cardinal & 30-deg compass labels around perimeter
    ctx.font = 'bold 11px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const compassLabels = [
      { rad: -Math.PI / 2, text: '000°(N)' },
      { rad: 0, text: '090°(E)' },
      { rad: Math.PI / 2, text: '180°(S)' },
      { rad: Math.PI, text: '270°(W)' }
    ];
    for (const c of compassLabels) {
      const lx = (R + 28) * Math.cos(c.rad);
      const ly = (R + 14) * Math.sin(c.rad);
      const isNorthHighlight =
        c.rad === -Math.PI / 2 && game.effects.northPassHighlightTimer > 0;
      ctx.fillStyle = isNorthHighlight ? '#FFFFFF' : 'rgba(0, 240, 200, 0.75)';
      ctx.fillText(c.text, lx, ly);
    }
    ctx.restore();
  }

  drawSweep(ctx, game, isDanger, isUnveil) {
    const R = CONSTANTS.RADAR_RADIUS;
    const sweepAngle = game.sweepAngle;
    const slices = 22;
    const sectorSpan = (55 * Math.PI) / 180; // 55 degrees trailing sector
    const sliceAngle = sectorSpan / slices;

    const baseRgb = isDanger ? '255, 150, 20' : '0, 255, 204';
    const maxAlpha = isUnveil ? 0.08 : 0.26;

    ctx.save();
    for (let i = 0; i < slices; i++) {
      const aStart = sweepAngle - (i + 1) * sliceAngle;
      const aEnd = sweepAngle - i * sliceAngle + 0.005;
      const ratio = 1 - i / slices;
      const alpha = maxAlpha * ratio * ratio;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, aStart, aEnd);
      ctx.closePath();
      ctx.fillStyle = `rgba(${baseRgb}, ${alpha.toFixed(4)})`;
      ctx.fill();
    }

    // Leading edge line
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(R * Math.cos(sweepAngle), R * Math.sin(sweepAngle));
    ctx.strokeStyle = isUnveil
      ? 'rgba(0, 255, 204, 0.35)'
      : isDanger
      ? '#FFAA00'
      : '#00FFCC';
    ctx.lineWidth = 2.0;
    if (!isUnveil) {
      ctx.shadowColor = isDanger ? '#FFAA00' : '#00FFCC';
      ctx.shadowBlur = 8;
    }
    ctx.stroke();
    ctx.restore();
  }

  drawTacticalPulse(ctx, game) {
    const pulse = game.activePulse;
    if (pulse && pulse.active && pulse.rCurr > 0) {
      const r = Math.min(CONSTANTS.RADAR_RADIUS, pulse.rCurr);
      const progress = r / CONSTANTS.RADAR_RADIUS;
      const alpha = Math.max(0.1, 1 - progress * 0.7);

      ctx.save();
      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 4.0 - 2.5 * progress;
      ctx.shadowColor = '#38BDF8';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TWO_PI);
      ctx.stroke();

      if (r > 14) {
        ctx.strokeStyle = `rgba(186, 230, 253, ${(alpha * 0.55).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, r - 12, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (game.effects.pulseBannerTimer > 0) {
      ctx.save();
      const a = Math.min(1, game.effects.pulseBannerTimer * 1.5);
      ctx.fillStyle = `rgba(56, 189, 248, ${a.toFixed(3)})`;
      ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('>> ACTIVE TACTICAL PING DEPLOYED <<', 0, -CONSTANTS.RADAR_RADIUS + 24);
      ctx.restore();
    }
  }

  drawBlipsAndVectors(ctx, game, isDanger, isUnveil) {
    // Dynamically group blips by targetId (newest first: index 0 is B_0, 1 is B_-1, 2 is B_-2, 3 is B_-3)
    const groups = { main: [], decoy: [], decoy2: [], decoy3: [] };
    for (const b of game.blipHistory) {
      if (!groups[b.targetId]) groups[b.targetId] = [];
      groups[b.targetId].push(b);
    }

    // Draw all decoy groups first, then 'main' last so real target stays on top
    const orderedIds = Object.keys(groups).filter(id => id !== 'main');
    orderedIds.push('main');

    for (const targetId of orderedIds) {
      const list = groups[targetId];
      if (!list || list.length === 0) continue;
      if (game.mode === 'ENDLESS') isDanger = !list[0].isDecoy && list[0].r <= CONSTANTS.DANGER_RADIUS;

      const isDecoy = game.mode === 'ENDLESS' ? Boolean(list[0].isDecoyEcho)
        : list[0].isDecoy ?? isDecoyTarget(targetId);
      const hasDecoyEcho = list.some(b => b.isDecoyEcho);

      // 1. Vector helper lines between B_-3 -> B_-2 -> B_-1 -> B_0
      if (list.length >= 2) {
        ctx.save();
        for (let i = 0; i < Math.min(list.length - 1, 3); i++) {
          const newer = list[i];
          const older = list[i + 1];
          ctx.beginPath();
          ctx.moveTo(older.x, older.y);
          ctx.lineTo(newer.x, newer.y);
          ctx.strokeStyle = hasDecoyEcho
            ? 'rgba(244, 63, 94, 0.42)'
            : isDecoy
            ? 'rgba(34, 211, 238, 0.30)'
            : isDanger
            ? 'rgba(255, 120, 90, 0.45)'
            : 'rgba(0, 255, 170, 0.38)';
          ctx.lineWidth = i === 0 ? 1.6 : 1.1;
          ctx.setLineDash(i === 0 ? [5, 4] : [2, 4]);
          ctx.stroke();
        }

        // Real-time Dynamic Lead Ghost (extrapolates elapsed blind time + bullet ETA)
        if (!isUnveil && (game.mode !== 'ENDLESS' || selectObservedTarget(game)?.targetId === targetId)) {
          const b0 = list[0];
          const lead = computeDynamicLeadPrediction(game, targetId);
          if (lead) {
            const leadStroke = hasDecoyEcho
              ? 'rgba(244, 63, 94, 0.35)'
              : isDecoy
              ? 'rgba(34, 211, 238, 0.42)'
              : 'rgba(255, 209, 102, 0.55)';

            ctx.beginPath();
            ctx.moveTo(b0.x, b0.y);
            ctx.lineTo(lead.currentEstX, lead.currentEstY);
            ctx.lineTo(lead.x, lead.y);
            ctx.strokeStyle = leadStroke;
            ctx.lineWidth = isDecoy ? 1.2 : 1.5;
            ctx.setLineDash([3, 4]);
            ctx.stroke();

            // Estimated current position marker (NOW)
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(lead.currentEstX, lead.currentEstY, 2.6, 0, TWO_PI);
            ctx.fillStyle = isDecoy
              ? 'rgba(34, 211, 238, 0.48)'
              : 'rgba(255, 209, 102, 0.55)';
            ctx.fill();

            // Dynamic Lead Ghost ring at (lead.x, lead.y)
            const ghostR = isDecoy ? 10 : 14;
            ctx.save();
            ctx.translate(lead.x, lead.y);
            ctx.strokeStyle = hasDecoyEcho
              ? 'rgba(244, 63, 94, 0.45)'
              : isDecoy
              ? 'rgba(34, 211, 238, 0.48)'
              : 'rgba(255, 209, 102, 0.78)';
            ctx.lineWidth = isDecoy ? 1.2 : 1.6;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.arc(0, 0, ghostR, 0, TWO_PI);
            ctx.stroke();

            // Inner crosshair ticks inside Lead Ghost
            ctx.setLineDash([]);
            const tick = isDecoy ? 4 : 6;
            ctx.beginPath();
            ctx.moveTo(-tick, 0);
            ctx.lineTo(tick, 0);
            ctx.moveTo(0, -tick);
            ctx.lineTo(0, tick);
            ctx.stroke();

            if (!isDecoy && !hasDecoyEcho) {
              ctx.fillStyle = 'rgba(255, 209, 102, 0.85)';
              ctx.font = 'bold 9px "JetBrains Mono", Consolas, monospace';
              ctx.fillText('予測', ghostR + 4, 3);
            }
            ctx.restore();
          }
        }
        ctx.restore();
      }

      // 2. Draw each blip from oldest to newest using round/target-specific geometry
      for (let idx = list.length - 1; idx >= 0; idx--) {
        const b = list[idx];
        const age = Math.max(0, game.roundTime - b.detectedAt);
        const lifeAlpha = Math.max(0, 1 - age / CONSTANTS.BLIP_LIFETIME);
        const genWeights = [1.0, 0.62, 0.36, 0.20];
        const alpha = lifeAlpha * (genWeights[idx] || 0.2);

        this.drawBlipShape(ctx, game, b, idx, alpha, isDanger, isUnveil);
        if (game.mode === 'ENDLESS' && idx === 0 && b.form) {
          this.drawEndlessObservationLabel(ctx, game, b, isDanger);
        }
      }
    }
  }

  drawEndlessObservationLabel(ctx, game, b, isDanger) {
    const r = Math.max(1, b.r);
    const inset = r <= CONSTANTS.DANGER_RADIUS
      ? Math.min(48, Math.max(22, r * 0.5))
      : Math.min(36, Math.max(24, r * 0.1));
    const x = b.x - (b.x / r) * inset;
    const y = b.y - (b.y / r) * inset;
    const rows = [
      { text: b.isDecoyEcho ? 'FAKE / HOLOGRAM PRISM' : b.form.name,
        font: 'bold 11px monospace', color: b.isDecoyEcho ? '#FDA4AF' : isDanger ? '#FF2A55' : '#00FFAA', dy: -12 },
      { text: b.targetId, font: '10px monospace', color: '#99EAD8', dy: 1 },
      { text: `${Math.round(b.r)}m (+${Math.max(0, game.roundTime - b.detectedAt).toFixed(1)}s)`,
        font: '9px "JetBrains Mono", Consolas, monospace', color: isDanger ? '#FF8899' : '#80FFDB', dy: 14 }
    ];
    ctx.save();
    for (const row of rows) {
      ctx.font = row.font;
      ctx.fillStyle = row.color;
      const label = fitRadarLabel(ctx, row.text, x, y + row.dy, 'center', this.width, this.height);
      ctx.textAlign = label.align;
      ctx.fillText(row.text, label.x, label.y);
    }
    ctx.restore();
  }

  drawBlipShape(ctx, game, b, idx, alpha, isDanger, isUnveil) {
    const isDecoy = game.mode === 'ENDLESS' ? Boolean(b.isDecoyEcho)
      : b.isDecoy ?? isDecoyTarget(b.targetId);
    const isOverdrive = game.mode !== 'ENDLESS' && (b.round || game.round) >= 6;
    const decoyNum = b.targetId === 'decoy2' ? 2 : b.targetId === 'decoy3' ? 3 : 1;
    const age = Math.max(0, game.roundTime - b.detectedAt);
    const s = idx === 0 ? 1.0 : idx === 1 ? 0.82 : idx === 2 ? 0.68 : 0.55;
    const shapeType =
      b.shapeType || getTargetShapeType(b.round || game.round, b.targetId);
    const heading =
      typeof b.heading === 'number'
        ? b.heading
        : normalizeAngle((b.theta || 0) + Math.PI);

    ctx.save();

    // 1. Expanding sonar ripple for first 0.85s after detection on latest blip B_0
    if (idx === 0 && age < 0.85 && !isUnveil && !b.isDecoyEcho) {
      const p = age / 0.85;
      const ripR = 6 + 28 * p;
      const ripAlpha = (1 - p) * 0.75;
      ctx.beginPath();
      ctx.arc(b.x, b.y, ripR, 0, TWO_PI);
      ctx.strokeStyle = isDanger
        ? `rgba(255, 60, 90, ${ripAlpha.toFixed(3)})`
        : isDecoy
        ? `rgba(34, 211, 238, ${ripAlpha.toFixed(3)})`
        : isOverdrive
        ? `rgba(0, 240, 255, ${ripAlpha.toFixed(3)})`
        : `rgba(0, 255, 170, ${ripAlpha.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Secondary inner overdrive ripple for WAVE 2 (R6-R10)
      if (isOverdrive && !isDecoy) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, ripR * 0.68, 0, TWO_PI);
        ctx.strokeStyle = `rgba(168, 85, 247, ${(ripAlpha * 0.8).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // 2. Tactical Pulse exposed Decoy Echo (Glitch Split Prism + X-Crack + FAKE tag)
    if (b.isDecoyEcho) {
      const phaseOffset = decoyNum * 2.1;
      const jitterX = (Math.sin(game.roundTime * 45 + idx + phaseOffset) * 1.8) | 0;
      const jitterY = (Math.cos(game.roundTime * 37 + idx + phaseOffset) * 1.8) | 0;
      const gx = b.x + jitterX;
      const gy = b.y + jitterY;

      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(heading);

      ctx.strokeStyle = `rgba(251, 113, 133, ${Math.max(0.55, alpha).toFixed(3)})`;
      ctx.fillStyle = `rgba(244, 63, 94, ${Math.max(0.3, alpha * 0.5).toFixed(3)})`;
      ctx.lineWidth = 2.0 * s;

      // Split hologram prism brackets
      ctx.beginPath();
      ctx.moveTo(0, -7.5 * s);
      ctx.lineTo(9.5 * s, 0);
      ctx.lineTo(0, 7.5 * s);
      ctx.moveTo(-1.5 * s, -6.5 * s);
      ctx.lineTo(-9.5 * s, 0);
      ctx.lineTo(-1.5 * s, 6.5 * s);
      ctx.stroke();

      // Glitch X-crack across decoy body
      ctx.strokeStyle = '#FDA4AF';
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.moveTo(-8 * s, -8 * s);
      ctx.lineTo(8 * s, 8 * s);
      ctx.moveTo(8 * s, -8 * s);
      ctx.lineTo(-8 * s, 8 * s);
      ctx.stroke();
      ctx.restore();

      if (idx === 0 && game.mode !== 'ENDLESS') {
        ctx.fillStyle = '#FDA4AF';
        ctx.font = 'bold 11px "JetBrains Mono", Consolas, monospace';
        const fakeLabel = (b.round || game.round) === 10 ? `FAKE #${decoyNum}` : 'FAKE / DECOY';
        const label = fitRadarLabel(ctx, fakeLabel, gx + 12, gy - 6, 'left', this.width, this.height);
        ctx.textAlign = label.align;
        ctx.fillText(fakeLabel, label.x, label.y);
      }
      ctx.restore();
      return;
    }

    // 3. Standard & Historical Blip Geometry oriented along heading (+X = forward nose)
    const glowColor = getRadarBlipColor({ isDanger, isDecoy, isOverdrive, form: b.form });
    const histColor = isDanger
      ? `rgba(255, 95, 115, ${alpha.toFixed(3)})`
      : isDecoy
      ? `rgba(34, 211, 238, ${alpha.toFixed(3)})`
      : isOverdrive
      ? `rgba(0, 240, 255, ${alpha.toFixed(3)})`
      : `rgba(0, 255, 170, ${alpha.toFixed(3)})`;
    const strokeColor = idx === 0 ? glowColor : histColor;
    const coreFillColor =
      game.mode === 'ENDLESS' ? strokeColor : idx === 0
        ? '#FFFFFF'
        : isDanger
        ? `rgba(255, 120, 140, ${(alpha * 0.45).toFixed(3)})`
        : `rgba(0, 255, 170, ${(alpha * 0.42).toFixed(3)})`;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(heading);

    if (idx === 0) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12;
    }

    if (shapeType === 'long_lance') {
      // III: a distinct long spearhead with a continuous rear shaft.
      ctx.beginPath();
      ctx.moveTo(23*s,0); ctx.lineTo(3*s,-7*s);
      ctx.lineTo(7*s,0); ctx.lineTo(3*s,7*s); ctx.closePath();
      ctx.moveTo(7*s,0); ctx.lineTo(-21*s,0);
      ctx.moveTo(-14*s,-4*s); ctx.lineTo(-14*s,4*s);
      ctx.strokeStyle=strokeColor; ctx.lineWidth=idx===0 ? 2 : 1.4; ctx.stroke();
    } else if (shapeType === 'delta_lance') {
      // Round 1 / Round 6: STRAIGHT APPROACH / HYPER LANCE — Sharp Delta Lance
      ctx.beginPath();
      ctx.moveTo(11 * s, 0);
      ctx.lineTo(-7 * s, -6.5 * s);
      ctx.lineTo(-3.5 * s, 0);
      ctx.lineTo(-7 * s, 6.5 * s);
      ctx.closePath();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = idx === 0 ? 1.8 : 1.4;
      ctx.stroke();

      // Inner delta core
      ctx.beginPath();
      ctx.moveTo(6.5 * s, 0);
      ctx.lineTo(-4 * s, -3.5 * s);
      ctx.lineTo(-2 * s, 0);
      ctx.lineTo(-4 * s, 3.5 * s);
      ctx.closePath();
      ctx.fillStyle = coreFillColor;
      ctx.fill();

      // Round 6 MK-II Overdrive additions: Forward canards + extended spear nose & tail pin
      if (isOverdrive) {
        ctx.beginPath();
        ctx.moveTo(3.5 * s, -2.5 * s);
        ctx.lineTo(7.5 * s, -7.5 * s);
        ctx.lineTo(1.5 * s, -4.5 * s);
        ctx.moveTo(3.5 * s, 2.5 * s);
        ctx.lineTo(7.5 * s, 7.5 * s);
        ctx.lineTo(1.5 * s, 4.5 * s);
        ctx.strokeStyle = idx === 0 ? '#A855F7' : strokeColor;
        ctx.lineWidth = 1.4 * s;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(11 * s, 0);
        ctx.lineTo(15.5 * s, 0);
        ctx.moveTo(-3.5 * s, 0);
        ctx.lineTo(-10.5 * s, 0);
        ctx.strokeStyle = idx === 0 ? '#FF3366' : strokeColor;
        ctx.lineWidth = 1.4 * s;
        ctx.stroke();
      }
    } else if (shapeType === 'crescent_wing') {
      // Round 2 / Round 7: ORBITAL SPIRAL / ELLIPTIC VORTEX — Crescent Wing + Spiral Turn Arc
      const turn = b.turnDir || b.turnSign || 1;
      ctx.beginPath();
      ctx.moveTo(-4 * s, -8.5 * s);
      quadCurveTo(ctx, 10 * s, 0, -4 * s, 8.5 * s);
      quadCurveTo(ctx, 2.5 * s, 0, -4 * s, -8.5 * s);
      ctx.closePath();
      ctx.fillStyle = coreFillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = idx === 0 ? 1.8 : 1.4;
      ctx.stroke();

      // Spiral turn direction wingtip guide arc
      if (idx <= 2) {
        ctx.beginPath();
        ctx.moveTo(4 * s, 0);
        quadCurveTo(ctx, 9 * s, turn * 4 * s, 5 * s, turn * 9 * s);
        ctx.strokeStyle = idx === 0 ? glowColor : strokeColor;
        ctx.lineWidth = 1.4 * s;
        ctx.stroke();
      }

      // Round 7 MK-II Overdrive additions: Outer overlay crescent & overdrive core ring
      if (isOverdrive) {
        ctx.beginPath();
        ctx.moveTo(-6.5 * s, -11 * s);
        quadCurveTo(ctx, 13.5 * s, 0, -6.5 * s, 11 * s);
        ctx.strokeStyle = idx === 0 ? '#A855F7' : strokeColor;
        ctx.lineWidth = 1.4 * s;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(1.5 * s, 0, 3.2 * s, 0, TWO_PI);
        ctx.strokeStyle = idx === 0 ? '#00F0FF' : strokeColor;
        ctx.lineWidth = 1.2 * s;
        ctx.stroke();
      }
    } else if (shapeType === 'twin_thruster') {
      // Round 3 / Round 8: PHANTOM ACCEL / PHANTOM BLINK — Twin-Thruster Needle & Afterburner Morph
      if (!b.isBoosted) {
        // Phase 1 Cruise: Slim Twin-Thruster Needle
        ctx.beginPath();
        ctx.moveTo(10.5 * s, 0);
        ctx.lineTo(0, -4.2 * s);
        ctx.lineTo(-8.5 * s, -2.2 * s);
        ctx.lineTo(-6.5 * s, 0);
        ctx.lineTo(-8.5 * s, 2.2 * s);
        ctx.lineTo(0, 4.2 * s);
        ctx.closePath();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = idx === 0 ? 1.8 : 1.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(6 * s, 0);
        ctx.lineTo(0, -2 * s);
        ctx.lineTo(-5 * s, 0);
        ctx.lineTo(0, 2 * s);
        ctx.closePath();
        ctx.fillStyle = coreFillColor;
        ctx.fill();

        if (isOverdrive) {
          ctx.beginPath();
          ctx.moveTo(4 * s, -2 * s);
          ctx.lineTo(8 * s, -6 * s);
          ctx.lineTo(1 * s, -3.5 * s);
          ctx.moveTo(4 * s, 2 * s);
          ctx.lineTo(8 * s, 6 * s);
          ctx.lineTo(1 * s, 3.5 * s);
          ctx.strokeStyle = idx === 0 ? '#00F0FF' : strokeColor;
          ctx.lineWidth = 1.3 * s;
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(-8.5 * s, -2.2 * s);
          ctx.lineTo(-12.5 * s, -2.2 * s);
          ctx.moveTo(-8.5 * s, 2.2 * s);
          ctx.lineTo(-12.5 * s, 2.2 * s);
          ctx.strokeStyle = idx === 0 ? '#A855F7' : strokeColor;
          ctx.stroke();
        }
      } else {
        // Phase 2 Boost: Variable Wings Deployed + Afterburner Jet Spikes
        ctx.beginPath();
        ctx.moveTo(13 * s, 0);
        ctx.lineTo(1 * s, -3.5 * s);
        ctx.lineTo(-5 * s, -7.5 * s);
        ctx.lineTo(-4 * s, -2.5 * s);
        ctx.lineTo(-8 * s, 0);
        ctx.lineTo(-4 * s, 2.5 * s);
        ctx.lineTo(-5 * s, 7.5 * s);
        ctx.lineTo(1 * s, 3.5 * s);
        ctx.closePath();
        ctx.fillStyle = coreFillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = idx === 0 ? 1.9 : 1.4;
        ctx.stroke();

        // 3 Afterburner Jet Spikes + Shockwave Cone
        ctx.shadowBlur = idx === 0 ? 10 : 0;
        ctx.strokeStyle = game.mode === 'ENDLESS' ? strokeColor : idx === 0 ? '#FFD166' : strokeColor;
        ctx.lineWidth = 2.0 * s;
        ctx.beginPath();
        ctx.moveTo(-8 * s, 0);
        ctx.lineTo(-18 * s, 0);
        ctx.moveTo(-6 * s, -3.5 * s);
        ctx.lineTo(-14 * s, -5.5 * s);
        ctx.moveTo(-6 * s, 3.5 * s);
        ctx.lineTo(-14 * s, 5.5 * s);
        ctx.moveTo(-11 * s, -5 * s);
        ctx.lineTo(-15 * s, 0);
        ctx.lineTo(-11 * s, 5 * s);
        ctx.stroke();

        if (isOverdrive) {
          // 5-Jet Plasma Spikes + 2nd Outer Mach Shock Cone
          ctx.beginPath();
          ctx.moveTo(-5 * s, -7.5 * s);
          ctx.lineTo(-16 * s, -9.5 * s);
          ctx.moveTo(-5 * s, 7.5 * s);
          ctx.lineTo(-16 * s, 9.5 * s);
          ctx.moveTo(-14 * s, -7.5 * s);
          ctx.lineTo(-21 * s, 0);
          ctx.lineTo(-14 * s, 7.5 * s);
          ctx.strokeStyle = idx === 0 ? '#00F0FF' : strokeColor;
          ctx.lineWidth = 1.6 * s;
          ctx.stroke();
        }
      }
    } else if (shapeType === 'sidewinder') {
      // Round 4 / Round 9: ZIGZAG VECTOR / VIPER SLALOM — Sidewinder Chevron & Canard Glow
      const zDir = b.turnDir || b.zigzagDir || 1;
      const ySide = zDir > 0 ? 1 : -1;

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = idx === 0 ? 1.8 : 1.4;
      ctx.beginPath();
      ctx.moveTo(-1 * s, -7.5 * s);
      ctx.lineTo(9.5 * s, 0);
      ctx.lineTo(-1 * s, 7.5 * s);
      ctx.moveTo(-7 * s, -6.5 * s);
      ctx.lineTo(3 * s, 0);
      ctx.lineTo(-7 * s, 6.5 * s);
      ctx.stroke();

      // Center diamond core
      ctx.beginPath();
      ctx.moveTo(7 * s, 0);
      ctx.lineTo(1 * s, -3.5 * s);
      ctx.lineTo(-4 * s, 0);
      ctx.lineTo(1 * s, 3.5 * s);
      ctx.closePath();
      ctx.fillStyle = coreFillColor;
      ctx.fill();

      // Active turn-side glowing canard fin
      ctx.beginPath();
      ctx.moveTo(4 * s, ySide * 3.5 * s);
      ctx.lineTo(2 * s, ySide * 10.5 * s);
      ctx.lineTo(-4 * s, ySide * 5.5 * s);
      ctx.strokeStyle = game.mode === 'ENDLESS' ? strokeColor : idx === 0 ? '#FFD166' : strokeColor;
      ctx.lineWidth = 1.8 * s;
      ctx.stroke();

      if (isOverdrive) {
        // 3rd leading chevron + counter-stabilizer fin
        ctx.beginPath();
        ctx.moveTo(2 * s, -6.5 * s);
        ctx.lineTo(13 * s, 0);
        ctx.lineTo(2 * s, 6.5 * s);
        ctx.strokeStyle = idx === 0 ? '#00F0FF' : strokeColor;
        ctx.lineWidth = 1.6 * s;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(2 * s, -ySide * 3.5 * s);
        ctx.lineTo(-1 * s, -ySide * 7.5 * s);
        ctx.strokeStyle = idx === 0 ? '#A855F7' : strokeColor;
        ctx.lineWidth = 1.4 * s;
        ctx.stroke();
      }
    } else if (shapeType === 'hologram_prism') {
      // Decoy ('decoy', 'decoy2', 'decoy3'): HOLOGRAM PRISM — Hollow Split Prism Diamond
      const phaseOffset = decoyNum * 2.1;
      const jx = idx === 0 ? Math.sin(game.roundTime * 32 + phaseOffset) * 1.1 : 0;
      const jy = idx === 0 ? Math.cos(game.roundTime * 27 + phaseOffset) * 1.1 : 0;

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = idx === 0 ? 1.8 : 1.3;
      ctx.beginPath();
      ctx.moveTo(jx + 0, jy - 6.5 * s);
      ctx.lineTo(jx + 8.5 * s, jy + 0);
      ctx.lineTo(jx + 0, jy + 6.5 * s);
      ctx.moveTo(-jx - 1.2 * s, -jy - 5.5 * s);
      ctx.lineTo(-jx - 8.5 * s, -jy + 0);
      ctx.lineTo(-jx - 1.2 * s, -jy + 5.5 * s);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(4 * s, 0);
      ctx.lineTo(0, -3 * s);
      ctx.lineTo(-4 * s, 0);
      ctx.lineTo(0, 3 * s);
      ctx.closePath();
      ctx.strokeStyle = game.mode === 'ENDLESS' ? strokeColor : idx === 0 ? '#FFFFFF' : strokeColor;
      ctx.lineWidth = 1.1 * s;
      ctx.stroke();
    } else {
      // Round 5 / Round 10 Main ('stealth_dreadnought'): Hexagonal Reactor Core + Stealth Dreadnought
      ctx.beginPath();
      ctx.moveTo(11 * s, 0);
      ctx.lineTo(2.5 * s, -8.5 * s);
      ctx.lineTo(-1.5 * s, -4.5 * s);
      ctx.lineTo(-7.5 * s, -7.0 * s);
      ctx.lineTo(-4.5 * s, 0);
      ctx.lineTo(-7.5 * s, 7.0 * s);
      ctx.lineTo(-1.5 * s, 4.5 * s);
      ctx.lineTo(2.5 * s, 8.5 * s);
      ctx.closePath();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = idx === 0 ? 1.9 : 1.4;
      ctx.stroke();

      // Inner hexagonal reactor core
      const hexR = 4.2 * s;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = (k * Math.PI) / 3;
        const hx = hexR * Math.cos(ang);
        const hy = hexR * Math.sin(ang);
        if (k === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fillStyle = coreFillColor;
      ctx.fill();

      if (isOverdrive) {
        // Round 10 MK-II Overdrive: Outer Overlord Shroud + Rotated Double Hexagon Reactor
        ctx.beginPath();
        ctx.moveTo(14.5 * s, 0);
        ctx.lineTo(3.5 * s, -11.5 * s);
        ctx.lineTo(-9.5 * s, -9.5 * s);
        ctx.moveTo(14.5 * s, 0);
        ctx.lineTo(3.5 * s, 11.5 * s);
        ctx.lineTo(-9.5 * s, 9.5 * s);
        ctx.strokeStyle = idx === 0 ? '#00F0FF' : strokeColor;
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();

        const hexR2 = 6.5 * s;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const ang = (k * Math.PI) / 3 + Math.PI / 6;
          const hx = hexR2 * Math.cos(ang);
          const hy = hexR2 * Math.sin(ang);
          if (k === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.strokeStyle = idx === 0 ? '#FF3366' : strokeColor;
        ctx.lineWidth = 1.2 * s;
        ctx.stroke();
      }
    }

    ctx.restore();

    // 4. Horizontal telemetry labels (unrotated for crisp readability)
    if (!isUnveil) {
      if (idx === 0) {
        if (!(game.mode === 'ENDLESS' && b.form)) {
          ctx.fillStyle = isDanger ? '#FF8899' : '#80FFDB';
          ctx.font = '10px "JetBrains Mono", Consolas, monospace';
          const telemetry = `${Math.round(b.r)}m (+${age.toFixed(1)}s)`;
          const telemetryLabel = fitRadarLabel(ctx, telemetry,
            b.x + (b.x > 0 ? -12 : 12), b.y - 6, b.x > 0 ? 'right' : 'left',
            this.width, this.height);
          ctx.textAlign = telemetryLabel.align;
          ctx.fillText(telemetry, telemetryLabel.x, telemetryLabel.y);
          if (b.form) {
            ctx.fillStyle = glowColor;
            ctx.font = 'bold 11px monospace';
            const align = b.x > 0 ? 'right' : 'left';
            const label = fitRadarLabel(ctx, b.form.name,
              b.x + (align === 'right' ? -18 : 18),
              b.y + (b.y > 0 ? -20 : 23), align, this.width, this.height);
            ctx.textAlign = label.align;
            ctx.fillText(b.form.name, label.x, label.y);
          }
        }
      } else {
        ctx.fillStyle = histColor;
        ctx.font = '9px "JetBrains Mono", Consolas, monospace';
        const historyLabel = fitRadarLabel(ctx, `-${idx}`, b.x + 7, b.y - 4,
          'left', this.width, this.height);
        ctx.textAlign = historyLabel.align;
        ctx.fillText(`-${idx}`, historyLabel.x, historyLabel.y);
      }
    }

    ctx.restore();
  }

  drawTruthUnveil(ctx, game) {
    // 1. Draw All Decoy True Trajectories (dashed slate grey) for Round 5 / Round 9 / Round 10
    const decoyKeys = Object.keys(game.trajectoryLog).filter(k => k !== 'main');
    for (const dk of decoyKeys) {
      const decoyLog = game.trajectoryLog[dk];
      if (decoyLog && decoyLog.length >= 2) {
        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.65)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(decoyLog[0].x, decoyLog[0].y);
        for (let i = 1; i < decoyLog.length; i++) {
          ctx.lineTo(decoyLog[i].x, decoyLog[i].y);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // 2. Draw Main Target True Trajectory (bright crimson/magenta solid line)
    const mainLog = game.trajectoryLog.main;
    if (mainLog && mainLog.length >= 2) {
      ctx.save();
      ctx.strokeStyle = '#FF3366';
      ctx.lineWidth = 2.4;
      ctx.shadowColor = '#FF3366';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(mainLog[0].x, mainLog[0].y);
      for (let i = 1; i < mainLog.length; i++) {
        ctx.lineTo(mainLog[i].x, mainLog[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 3. Draw True Target Vector Silhouettes & Hitbox Rings (decoys first, then main on top)
    const decoys = game.targets.filter(t => isDecoyTarget(t.id));
    const mains = game.targets.filter(t => !isDecoyTarget(t.id));
    for (const tgt of [...decoys, ...mains]) {
      this.drawEnemySilhouette(ctx, game, tgt);
    }

    // 4. On MISS: Draw CPA (Closest Point of Approach) error indicator & MISS BY XX px badge
    if (
      game.state === 'RESULT_FAIL' &&
      game.lastResult &&
      game.lastResult.reason !== 'CORE_BREACHED' &&
      game.cpaInfo
    ) {
      const cpa = game.cpaInfo;
      ctx.save();
      ctx.strokeStyle = '#FFD166';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cpa.bulletX, cpa.bulletY);
      ctx.lineTo(cpa.enemyX, cpa.enemyY);
      ctx.stroke();

      // Endpoints at CPA
      ctx.setLineDash([]);
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.arc(cpa.bulletX, cpa.bulletY, 4.0, 0, TWO_PI);
      ctx.fill();

      ctx.fillStyle = '#FFD166';
      ctx.beginPath();
      ctx.arc(cpa.enemyX, cpa.enemyY, 4.0, 0, TWO_PI);
      ctx.fill();

      // Midpoint badge: MISS BY XX px
      const midX = (cpa.bulletX + cpa.enemyX) / 2;
      const midY = (cpa.bulletY + cpa.enemyY) / 2 - 14;
      const missText = `MISS BY ${game.lastResult.minMissDistance} px`;
      ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
      const tw = ctx.measureText(missText).width;
      ctx.fillStyle = 'rgba(10, 14, 22, 0.88)';
      ctx.fillRect(midX - tw / 2 - 6, midY - 11, tw + 12, 20);
      ctx.strokeStyle = '#FFD166';
      ctx.lineWidth = 1.0;
      ctx.strokeRect(midX - tw / 2 - 6, midY - 11, tw + 12, 20);

      ctx.fillStyle = '#FFD166';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(missText, midX, midY - 1);
      ctx.restore();
    }

    // 5. On CLEAR: Draw precision offset & distance score popup above hit point
    if (game.state === 'RESULT_CLEAR' && game.lastResult && game.bullet) {
      const bx = game.bullet.x;
      const by = game.bullet.y - 26;
      const res = game.lastResult;
      const tag = res.isBullseye
        ? `BULLSEYE! (OFFSET: ${res.hitOffsetPx}px)`
        : `DIRECT HIT! (OFFSET: ${res.hitOffsetPx}px)`;

      ctx.save();
      ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = res.isBullseye ? '#FFD166' : '#00FFAA';
      ctx.fillText(tag, bx, by);

      const distM = res.impactRadiusPx ?? res.hitDistanceM ?? 0;
      const distPts = res.distanceScore ?? res.rangeBonus ?? res.baseScore ?? 0;
      if (res.isLongRangeSnipe) {
        ctx.fillStyle = '#00F0FF';
        ctx.fillText(`LONG-RANGE SNIPE! (${distM}m / +${distPts})`, bx, by - 15);
      } else if (res.isDangerClose) {
        ctx.fillStyle = '#FF5577';
        ctx.fillText(`DANGER CLOSE PENALTY (${distM}m / +${distPts})`, bx, by - 15);
      } else {
        ctx.fillStyle = '#00FFAA';
        ctx.fillText(`RANGE SCORE: +${distPts} pts (${distM}m)`, bx, by - 15);
      }

      if (res.isBlindSnipe) {
        ctx.fillStyle = '#38BDF8';
        ctx.fillText(`BLIND SNIPE! (+${res.blindTime}s)`, bx, by - 30);
      }
      ctx.restore();
    }
  }

  drawEnemySilhouette(ctx, game, tgt) {
    const isDecoy = isDecoyTarget(tgt.id);
    const isOverdrive = game.round >= 6;
    const decoyNum = tgt.id === 'decoy2' ? 2 : tgt.id === 'decoy3' ? 3 : 1;
    const shapeType =
      tgt.shapeType || getTargetShapeType(game.round, tgt.id);
    const heading =
      typeof tgt.heading === 'number'
        ? tgt.heading
        : normalizeAngle((tgt.theta || 0) + Math.PI);

    ctx.save();

    // 1. Effective combined hit radius ring (R_HIT = 22px)
    ctx.strokeStyle = isDecoy
      ? 'rgba(148, 163, 184, 0.45)'
      : 'rgba(255, 209, 102, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(tgt.x, tgt.y, CONSTANTS.R_HIT, 0, TWO_PI);
    ctx.stroke();

    // 2. Physical target hitbox reference ring (TARGET_RADIUS = 16px)
    ctx.setLineDash([]);
    ctx.strokeStyle = isDecoy
      ? 'rgba(148, 163, 184, 0.32)'
      : 'rgba(255, 51, 102, 0.35)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(tgt.x, tgt.y, CONSTANTS.TARGET_RADIUS, 0, TWO_PI);
    ctx.stroke();

    // 3. Vector fighter / stealth silhouette rotated to heading (+X = nose)
    ctx.save();
    ctx.translate(tgt.x, tgt.y);
    ctx.rotate(heading);

    const bodyFill = isOverdrive
      ? 'rgba(168, 85, 247, 0.28)'
      : 'rgba(255, 51, 102, 0.28)';

    if (shapeType === 'delta_lance') {
      // Round 1 / Round 6: Delta Lance High-Speed Interceptor
      ctx.fillStyle = bodyFill;
      ctx.strokeStyle = '#FF3366';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(4, -4);
      ctx.lineTo(-12, -13);
      ctx.lineTo(-15, -7);
      ctx.lineTo(-11, -3);
      ctx.lineTo(-16, 0);
      ctx.lineTo(-11, 3);
      ctx.lineTo(-15, 7);
      ctx.lineTo(-12, 13);
      ctx.lineTo(4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (isOverdrive) {
        // MK-II Forward Canard & Twin Lance Shroud
        ctx.strokeStyle = '#00F0FF';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(8, -2);
        ctx.lineTo(13, -9);
        ctx.lineTo(5, -5);
        ctx.moveTo(8, 2);
        ctx.lineTo(13, 9);
        ctx.lineTo(5, 5);
        ctx.moveTo(22, 0);
        ctx.lineTo(-18, 0);
        ctx.stroke();

        ctx.strokeStyle = '#FFD166';
        ctx.beginPath();
        ctx.moveTo(-15, -5);
        ctx.lineTo(-22, 0);
        ctx.lineTo(-15, 5);
        ctx.stroke();
      }

      // Center lance spine & diamond cockpit
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(14, 0);
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(0, -2.5);
      ctx.lineTo(-5, 0);
      ctx.lineTo(0, 2.5);
      ctx.closePath();
      ctx.fill();
    } else if (shapeType === 'crescent_wing') {
      // Round 2 / Round 7: Crescent Wing Forward-Swept Orbital Saucer
      ctx.fillStyle = bodyFill;
      ctx.strokeStyle = '#FF3366';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(6, -15);
      quadCurveTo(ctx, 17, 0, 6, 15);
      ctx.lineTo(-2, 11);
      quadCurveTo(ctx, 5, 0, -2, -11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const spinBase = (game.roundTime || 0) * 6 * (tgt.turnSign || 1);

      if (isOverdrive) {
        // MK-II Outer Crescent Blade & Counter-Rotating Dual Gyro Ring
        ctx.strokeStyle = '#00F0FF';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(4, -19);
        quadCurveTo(ctx, 21, 0, 4, 19);
        ctx.lineTo(-5, 14);
        ctx.stroke();

        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(2, 0, 9.5, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a = -spinBase * 1.4 + (k * TWO_PI) / 3;
          ctx.moveTo(2, 0);
          ctx.lineTo(2 + 9 * Math.cos(a), 9 * Math.sin(a));
        }
        ctx.stroke();
      }

      // Central gyro rotor ring & spinning blades
      ctx.strokeStyle = '#FF8099';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(2, 0, 6.5, 0, TWO_PI);
      ctx.stroke();

      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = spinBase + (k * TWO_PI) / 3;
        ctx.moveTo(2, 0);
        ctx.lineTo(2 + 6 * Math.cos(a), 6 * Math.sin(a));
      }
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(2, 0, 2.5, 0, TWO_PI);
      ctx.fill();
    } else if (shapeType === 'twin_thruster') {
      // Round 3 / Round 8: Twin-Thruster Variable-Sweep Booster Jet
      ctx.fillStyle = bodyFill;
      ctx.strokeStyle = '#FF3366';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(5, -3);
      ctx.lineTo(7, -7);
      ctx.lineTo(2, -4);
      ctx.lineTo(-8, -13);
      ctx.lineTo(-13, -10);
      ctx.lineTo(-16, -5);
      ctx.lineTo(-12, -2);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-12, 2);
      ctx.lineTo(-16, 5);
      ctx.lineTo(-13, 10);
      ctx.lineTo(-8, 13);
      ctx.lineTo(2, 4);
      ctx.lineTo(7, 7);
      ctx.lineTo(5, 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Twin afterburner plumes (expanded when isBoosted / isOverdrive)
      const plumeLen = isOverdrive
        ? tgt.isBoosted
          ? 35
          : 25
        : tgt.isBoosted
        ? 29
        : 22;
      ctx.fillStyle = 'rgba(255, 209, 102, 0.80)';
      ctx.beginPath();
      ctx.moveTo(-15, -5.5);
      ctx.lineTo(-plumeLen, -4.0);
      ctx.lineTo(-15, -2.2);
      ctx.closePath();
      ctx.moveTo(-15, 2.2);
      ctx.lineTo(-plumeLen, 4.0);
      ctx.lineTo(-15, 5.5);
      ctx.closePath();
      ctx.fill();

      if (isOverdrive) {
        // MK-II Ramjet Side Pods & High-Heat Cyan Plasma Plume Core
        ctx.strokeStyle = '#00F0FF';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-2, -8);
        ctx.lineTo(8, -11);
        ctx.lineTo(-12, -16);
        ctx.moveTo(-2, 8);
        ctx.lineTo(8, 11);
        ctx.lineTo(-12, 16);
        ctx.stroke();

        ctx.fillStyle = '#00F0FF';
        ctx.beginPath();
        ctx.moveTo(-14, -2);
        ctx.lineTo(-plumeLen * 0.85, 0);
        ctx.lineTo(-14, 2);
        ctx.closePath();
        ctx.fill();
      }

      // Cockpit core
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(2, -2.2);
      ctx.lineTo(-4, 0);
      ctx.lineTo(2, 2.2);
      ctx.closePath();
      ctx.fill();
    } else if (shapeType === 'sidewinder') {
      // Round 4 / Round 9: Sidewinder X-Wing Slalomer
      ctx.fillStyle = bodyFill;
      ctx.strokeStyle = '#FF3366';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(10, -12);
      ctx.lineTo(1, -5);
      ctx.lineTo(-11, -14);
      ctx.lineTo(-9, -4);
      ctx.lineTo(-15, 0);
      ctx.lineTo(-9, 4);
      ctx.lineTo(-11, 14);
      ctx.lineTo(1, 5);
      ctx.lineTo(10, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (isOverdrive) {
        // MK-II Split Nose & Vector Nozzle
        ctx.strokeStyle = '#00F0FF';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(20, -3.5);
        ctx.lineTo(12, -3);
        ctx.moveTo(15, 0);
        ctx.lineTo(20, 3.5);
        ctx.lineTo(12, 3);
        ctx.moveTo(-15, 0);
        ctx.lineTo(-20, -4);
        ctx.moveTo(-15, 0);
        ctx.lineTo(-20, 4);
        ctx.stroke();
      }

      // Internal X-frame vector lines
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(8, -9);
      ctx.lineTo(-8, 9);
      ctx.moveTo(8, 9);
      ctx.lineTo(-8, -9);
      ctx.stroke();

      // Active turn-side canard highlight
      const ySide = (tgt.turnDir || tgt.zigzagDir || 1) > 0 ? 1 : -1;
      ctx.strokeStyle = '#FFD166';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(10, ySide * 12);
      ctx.lineTo(1, ySide * 5);
      ctx.stroke();
    } else if (shapeType === 'hologram_prism') {
      // Decoy ('decoy', 'decoy2', 'decoy3'): 4-Split Floating Hologram Projector Drone
      ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 1.6;

      const offsets = [
        [9, 0],
        [-9, 0],
        [0, -9],
        [0, 9]
      ];
      for (const [ox, oy] of offsets) {
        ctx.beginPath();
        ctx.moveTo(ox + 4.5, oy);
        ctx.lineTo(ox, oy - 3.5);
        ctx.lineTo(ox - 4.5, oy);
        ctx.lineTo(ox, oy + 3.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(12, 0);
      ctx.moveTo(0, -12);
      ctx.lineTo(0, 12);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // Round 5 / Round 10 Main ('stealth_dreadnought'): Serrated Stealth Dreadnought + Reactor Core
      ctx.fillStyle = isOverdrive ? 'rgba(168, 85, 247, 0.32)' : 'rgba(255, 51, 102, 0.30)';
      ctx.strokeStyle = '#FF3366';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(2, -16);
      ctx.lineTo(-6, -16);
      ctx.lineTo(-3, -10);
      ctx.lineTo(-11, -8);
      ctx.lineTo(-7, -3);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-7, 3);
      ctx.lineTo(-11, 8);
      ctx.lineTo(-3, 10);
      ctx.lineTo(-6, 16);
      ctx.lineTo(2, 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (isOverdrive) {
        // MK-II Floating Shield Blades + Outer Hexagon Ring
        ctx.strokeStyle = '#00F0FF';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-2, -19);
        ctx.lineTo(10, -12);
        ctx.moveTo(-2, 19);
        ctx.lineTo(10, 12);
        for (let k = 0; k < 6; k++) {
          const ang = (k * Math.PI) / 3 + Math.PI / 6;
          const hx = 8.5 * Math.cos(ang);
          const hy = 8.5 * Math.sin(ang);
          if (k === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // Central hexagonal reactor core
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = (k * Math.PI) / 3;
        const hx = 5.5 * Math.cos(ang);
        const hy = 5.5 * Math.sin(ang);
        if (k === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, TWO_PI);
      ctx.fill();
    }

    ctx.restore();

    // 4. Horizontal target label
    ctx.font = 'bold 11px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = isDecoy ? '#94A3B8' : '#FF8099';
    const labelText = isDecoy
      ? game.round === 10
        ? `DECOY #${decoyNum}`
        : 'DECOY'
      : tgt.destroyed
      ? 'HIT TARGET'
      : 'TRUE TARGET';
    ctx.fillText(labelText, tgt.x + 22, tgt.y - 12);
    ctx.restore();
  }

  drawBullet(ctx, game, isUnveil) {
    if (!game.bullet) return;
    const b = game.bullet;
    if (game.mode === 'ENDLESS' && !b.active) return;

    ctx.save();
    // Full bullet trajectory line from origin (0, 0) to current/final bullet position
    ctx.strokeStyle = isUnveil
      ? 'rgba(56, 189, 248, 0.80)'
      : 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = isUnveil ? 2.2 : 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // Designated aim marker where player clicked + EMP blast zone indicator
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.65)';
    ctx.lineWidth = 1.2;
    const ax = b.aimX ?? game.firedAimX;
    const ay = b.aimY ?? game.firedAimY;
    ctx.beginPath();
    ctx.moveTo(ax - 5, ay - 5);
    ctx.lineTo(ax + 5, ay + 5);
    ctx.moveTo(ax + 5, ay - 5);
    ctx.lineTo(ax - 5, ay + 5);
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.30)';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(ax, ay, CONSTANTS.BLAST_RADIUS, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();

    // Active railgun slug & high-energy plasma streak
    if (b.active || isUnveil) {
      const tailLen = Math.min(b.r, 48);
      const tx = (b.r - tailLen) * Math.cos(b.angle);
      const ty = (b.r - tailLen) * Math.sin(b.angle);

      const streakGrad = ctx.createLinearGradient(tx, ty, b.x, b.y);
      streakGrad.addColorStop(0, 'rgba(56, 189, 248, 0.0)');
      streakGrad.addColorStop(1, '#FFFFFF');

      ctx.strokeStyle = streakGrad;
      ctx.lineWidth = 4.0;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.shadowColor = '#38BDF8';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(b.x, b.y, CONSTANTS.BULLET_RADIUS, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  drawEffects(ctx, game) {
    const fx = game.effects;

    // Muzzle flash
    if (fx.muzzleFlashTimer > 0) {
      const a = fx.muzzleFlashTimer / 0.12;
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${(a * 0.85).toFixed(3)})`;
      ctx.shadowColor = '#38BDF8';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, 26 * a, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }

    // Expanding shockwaves
    for (const sw of fx.shockwaves) {
      ctx.save();
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.r, 0, TWO_PI);
      ctx.stroke();
      ctx.restore();
    }

    // Shatter particles
    for (const p of fx.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }
  }

  drawCoreTurret(ctx, game, isDanger) {
    const isBreached =
      game.state === 'RESULT_FAIL' &&
      game.lastResult &&
      game.lastResult.reason === 'CORE_BREACHED';
    const coreColor = isBreached ? '#FF2244' : isDanger ? '#FFCC00' : '#00F0FF';

    ctx.save();
    // Outer core ring (CORE_RADIUS = 18px)
    ctx.strokeStyle = coreColor;
    ctx.fillStyle = 'rgba(6, 18, 26, 0.90)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.arc(0, 0, CONSTANTS.CORE_RADIUS, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();

    // Gun barrel pointing along aimAngle
    ctx.rotate(game.aimAngle);
    ctx.strokeStyle = '#FFD166';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(CONSTANTS.CORE_RADIUS + 10, 0);
    ctx.stroke();

    // Center turret core dot
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, 4.0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  drawReticle(ctx, game, isDanger) {
    const ax = game.aimX;
    const ay = game.aimY;
    const color = isDanger ? '#FF7B7B' : '#FFD166';

    ctx.save();
    // 1. Firing laser sight line from origin to reticle
    ctx.strokeStyle = isDanger
      ? 'rgba(255, 107, 107, 0.35)'
      : 'rgba(255, 209, 102, 0.35)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Reticle crosshair, EMP plasma blast ring & outer ring at (ax, ay)
    ctx.translate(ax, ay);

    // Target-Point EMP Detonation AOE ring (BLAST_RADIUS = 44px)
    ctx.save();
    ctx.fillStyle = isDanger
      ? 'rgba(255, 107, 107, 0.04)'
      : 'rgba(56, 189, 248, 0.04)';
    ctx.strokeStyle = isDanger
      ? 'rgba(255, 107, 107, 0.24)'
      : 'rgba(56, 189, 248, 0.24)';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, CONSTANTS.BLAST_RADIUS, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;

    // Outer dashed ring (radius 18px)
    ctx.save();
    ctx.rotate(game.roundTime * 0.8);
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();

    // Split crosshair lines (6px..15px)
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];
    for (const [dx, dy] of dirs) {
      ctx.beginPath();
      ctx.moveTo(dx * 6, dy * 6);
      ctx.lineTo(dx * 15, dy * 15);
      ctx.stroke();
    }

    // Center pinpoint dot
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, TWO_PI);
    ctx.fill();

    // 3. Floating telemetry tag beside reticle: distance, bearing and time to impact
    const dist = Math.round(game.aimDist);
    const eta = (game.aimDist / CONSTANTS.BULLET_SPEED).toFixed(2);
    const compassDeg = Math.round(
      ((normalizeAngle(game.aimAngle + Math.PI / 2) * 180) / Math.PI) % 360
    )
      .toString()
      .padStart(3, '0');

    const flipX = ax > 200 ? -136 : 20;
    const flipY = ay > 220 ? -46 : 12;

    ctx.fillStyle = 'rgba(4, 10, 16, 0.85)';
    ctx.fillRect(flipX - 4, flipY - 11, 124, 31);
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.45)';
    ctx.lineWidth = 1.0;
    ctx.strokeRect(flipX - 4, flipY - 11, 124, 31);

    ctx.fillStyle = color;
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${dist}m / ${compassDeg}°`, flipX, flipY);
    ctx.fillStyle = '#38BDF8';
    ctx.fillText(`ETA ${eta}s`, flipX, flipY + 13);

    ctx.restore();
  }
}
