『blind-radar-shot』の追加・変更要件（WAVE 2：Round 6〜10の追加による全10ラウンド化、および距離比例型スコア計算への刷新）に基づく企画仕様の拡張・更新定義は以下の通りです。

---

# 『blind-radar-shot』拡張企画仕様書（全10ラウンド制 ＆ 距離減衰スコア仕様）

## 1. 全10ラウンド構成と WAVE 2（Round 6〜10）軌道・デコイ仕様

- **総ラウンド数**: `MAX_ROUNDS = 10`（Round 1〜5：WAVE 1、Round 6〜10：WAVE 2 上位強化版）
- **初期状態の配列長**:
  - `game.roundScores`: 長さ `10` の配列 `Array(10).fill(0)`
  - `game.roundResults`: 長さ `10` の配列 `Array(10).fill(null)`
  - `game.trajectoryLog`: `{ main: [], decoy: [], decoy2: [], decoy3: [] }`
- **クリア遷移条件**: `RESULT_CLEAR` 後の次ラウンド遷移において、`game.round < 10` の場合は `initRound(game, game.round + 1, undefined, false)` へ進み、`game.round === 10` クリア時に `ALL_CLEAR` へ遷移する。

### 1.1 `ROUND_DEFS` 追加定義（Round 6〜10）

| Round | `codeName` | `profile` | `desc`（ブリーフィング説明） | ターゲット構成 | `shapeType` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **6** | `HYPER LANCE` | `Dogleg Linear Vector (Turn at r=190m)` | 高速ドッグレッグ突撃 — 外周から高速直進し、中距離（190m付近）で鋭角にコースを折り曲げる！ | `['main']` | `'delta_lance'` |
| **7** | `ELLIPTIC VORTEX` | `Accelerating Angular Spiral` | 加速楕円スパイラル — 接近するにつれて旋回角速度が増大し、半径もうねる。早めの遠距離狙撃が有効！ | `['main']` | `'crescent_wing'` |
| **8** | `PHANTOM BLINK` | `Boost + Lateral Phase Shift (r <= 240m)` | 位相ブリンク変速 — 距離240mで2.5倍急加速と同時に横方向へ位相シフト変針する高速アサシン！ | `['main']` | `'twin_thruster'` |
| **9** | `VIPER SLALOM` | `High-Freq Slalom (2.2s) + Decoy` | 高速スラローム＋撹乱デコイ — 2.2秒周期の鋭い切り返しに偽反応1機が伴走する。本物の周期を読め！ | `['main', 'decoy']` | `main`: `'sidewinder'`<br>`decoy`: `'hologram_prism'` |
| **10** | `OMEGA MIRAGE` | `Stealth Boss + Triple Electronic Decoys` | 最終決戦：4重ミラージュ — 本物1機＋デコイ3機が同時侵攻！等間隔の真軌道か戦術パルスで見破れ！ | `['main', 'decoy', 'decoy2', 'decoy3']` | `main`: `'stealth_dreadnought'`<br>全デコイ: `'hologram_prism'` |

---

### 1.2 Round 6〜10 の確定軌道数式（`evalRawCoords(round, targetId, t, theta0, s)`）

経過時間 $\text{time} = \max(0, t)$（秒）、初期方位角 $\theta_0 \in [0, 2\pi)$、旋回方向符号 $s \in \{+1, -1\}$ とする。

#### Round 6: `HYPER LANCE`（R1強化：2段ドッグレッグ高速直線突撃）
外周 $r_0 = 345\text{ px}$ から中距離折り返し点 $P_1$（$r_1 = 190\text{ px}$）へ高速直進し、$P_1$ で逆回転方向の内周点 $P_2$（$r_2 = 65\text{ px}$）へ鋭角に折れ曲がった後、コア `(0, 0)` へ直進突入する。
- **制御点定義**:
  $$P_0 = (345 \cos \theta_0, \; 345 \sin \theta_0)$$
  $$\theta_1 = \theta_0 + s \cdot 0.30\pi, \quad P_1 = (190 \cos \theta_1, \; 190 \sin \theta_1)$$
  $$\theta_2 = \theta_0 - s \cdot 0.18\pi, \quad P_2 = (65 \cos \theta_2, \; 65 \sin \theta_2)$$
- **区間距離・速度・到達時刻**:
  - フェーズ1（$P_0 \to P_1$）：距離 $D_1 = \|P_1 - P_0\|$、速度 $V_1 = 42.0\text{ px/s}$、所要時間 $t_1 = D_1 / V_1$（約 `5.85s`）
  - フェーズ2（$P_1 \to P_2$）：距離 $D_2 = \|P_2 - P_1\|$、速度 $V_2 = 46.0\text{ px/s}$、所要時間 $\Delta t_2 = D_2 / V_2$、完了時刻 $t_2 = t_1 + \Delta t_2$（約 `10.12s`）
  - フェーズ3（$P_2 \to \text{Core}$）：速度 $V_3 = 50.0\text{ px/s}$ で角度 $\theta_2$ に沿って中心へ突入
- **座標評価式**:
  - $0 \le \text{time} \le t_1$:
    $$(x, y) = P_0 + (P_1 - P_0) \cdot \frac{V_1 \cdot \text{time}}{D_1}$$
  - $t_1 < \text{time} \le t_2$:
    $$(x, y) = P_1 + (P_2 - P_1) \cdot \frac{V_2 \cdot (\text{time} - t_1)}{D_2}$$
  - $\text{time} > t_2$:
    $$r = \max\big(0, \; 65 - V_3 \cdot (\text{time} - t_2)\big), \quad \theta = \operatorname{normalizeAngle}(\theta_2), \quad (x, y) = (r \cos \theta, \; r \sin \theta)$$

#### Round 7: `ELLIPTIC VORTEX`（R2強化：角速度加速＋楕円うねりスパイラル）
接近するにつれて旋回角速度が線形に増加（$\omega(t) = 0.26 + 0.036 t\text{ rad/s}$）し、半径方向にも周期的な楕円うねりを伴う。
$$r(\text{time}) = \max\big(0, \; 345 - 29.0 \cdot \text{time} + 14.0 \sin(2.2 \cdot \text{time})\big)$$
$$\theta(\text{time}) = \operatorname{normalizeAngle}\Big(\theta_0 + s \cdot \big(0.26 \cdot \text{time} + 0.018 \cdot \text{time}^2\big)\Big)$$
$$(x, y) = (r \cos \theta, \; r \sin \theta)$$

#### Round 8: `PHANTOM BLINK`（R3強化：2段階急加速＋$r \le 240\text{px}$ 位相ブリンク変針）
$\text{time} = 5.0\text{ s}$（$r = 240\text{ px}$ 到達時）にブースト点火し、接近速度が $22.0 \to 55.0\text{ px/s}$（2.5倍）に跳ね上がると同時に、`0.25秒` かけて横方向へ $+0.35\text{ rad}$（約 $20^\circ$）の位相ブリンク変針を行う。
- **フェーズ1（$0 \le \text{time} < 5.0\text{ s}$、$r > 240\text{ px}$）**:
  $$r(\text{time}) = 350 - 22.0 \cdot \text{time}$$
  $$\theta(\text{time}) = \operatorname{normalizeAngle}(\theta_0 + s \cdot 0.20 \cdot \text{time})$$
- **フェーズ2（$\text{time} \ge 5.0\text{ s}$、$r \le 240\text{ px}$：ブースト＆位相ブリンク）**:
  $$\tau = \text{time} - 5.0, \quad \text{blinkShift} = 0.35 \cdot \min\left(1.0, \; \frac{\tau}{0.25}\right)$$
  $$r(\text{time}) = \max(0, \; 240 - 55.0 \cdot \tau)$$
  $$\theta(\text{time}) = \operatorname{normalizeAngle}\Big(\theta_0 + s \cdot \big(1.00 + \text{blinkShift} + 0.32 \cdot \tau\big)\Big)$$
- **ブースト状態フラグ（`computeTargetCoords` 内）**:
  `isBoosted = (round === 3 && (time >= 6.0 || cur.r <= 230.0 + 1e-6)) || (round === 8 && (time >= 5.0 || cur.r <= 240.0 + 1e-6))`

#### Round 9: `VIPER SLALOM`（R4強化：2.2秒短周期スラローム＋撹乱デコイ1機）
- **本物（`targetId === 'main'`）**:
  周期 `period = 2.2 秒`、角速度振幅 `omegaMag = 0.52 rad/s` で鋭く切り返す。
  $$r_{\text{main}}(\text{time}) = \max(0, \; 350 - 30.0 \cdot \text{time})$$
  $$\text{phaseIndex} = \lfloor \text{time} / 2.2 \rfloor, \quad t_{\text{local}} = \text{time} - \text{phaseIndex} \times 2.2$$
  $$\Delta\theta = \begin{cases} s \cdot 0.52 \cdot t_{\text{local}} & (\text{phaseIndex} \bmod 2 === 0) \\ s \cdot 0.52 \cdot (2.2 - t_{\text{local}}) & (\text{phaseIndex} \bmod 2 === 1) \end{cases}$$
  $$\theta_{\text{main}}(\text{time}) = \operatorname{normalizeAngle}(\theta_0 + \Delta\theta)$$
  - `computeTargetCoords` 内の `period` は `round === 9 ? 2.2 : 3.6`、`turnDir` は `(round === 4 || round === 9) ? zigzagDir : s` とする。
- **伴走デコイ（`targetId === 'decoy'`）**:
  $$r_{\text{decoy}}(\text{time}) = \max\big(60, \; 350 - 29.0 \cdot \text{time} + 24.0 \sin(2.4 \cdot \text{time})\big)$$
  $$\theta_{\text{decoy}}(\text{time}) = \operatorname{normalizeAngle}\Big(\theta_0 - s \cdot 0.55 - s \cdot \big(0.30 \cdot \text{time} + 0.25 \sin(2.0 \cdot \text{time})\big)\Big)$$

#### Round 10: `OMEGA MIRAGE`（R5強化最終ボス：本物1機＋デコイ3機の計4目標）
- **本物（`targetId === 'main'`）**:
  一切の正弦波脈動を持たず、完全等速・等角速度でコアへ突入する。
  $$r_{\text{main}}(\text{time}) = \max(0, \; 355 - 32.0 \cdot \text{time})$$
  $$\theta_{\text{main}}(\text{time}) = \operatorname{normalizeAngle}(\theta_0 + s \cdot 0.36 \cdot \text{time})$$
- **デコイ1号機（`targetId === 'decoy'`）**:
  $$r_1(\text{time}) = \max\big(60, \; 355 - 31.0 \cdot \text{time} + 25.0 \sin(2.0 \cdot \text{time})\big)$$
  $$\theta_1(\text{time}) = \operatorname{normalizeAngle}\Big(\theta_0 + s \cdot 0.55 + s \cdot \big(0.36 \cdot \text{time} + 0.24 \sin(1.7 \cdot \text{time})\big)\Big)$$
- **デコイ2号機（`targetId === 'decoy2'`）**:
  $$r_2(\text{time}) = \max\big(60, \; 355 - 30.0 \cdot \text{time} + 28.0 \cos(2.3 \cdot \text{time})\big)$$
  $$\theta_2(\text{time}) = \operatorname{normalizeAngle}\Big(\theta_0 - s \cdot 0.60 + s \cdot \big(0.34 \cdot \text{time} - 0.26 \sin(1.9 \cdot \text{time})\big)\Big)$$
- **デコイ3号機（`targetId === 'decoy3'`）**:
  $$r_3(\text{time}) = \max\big(60, \; 355 - 33.0 \cdot \text{time} + 22.0 \sin(2.6 \cdot \text{time} + 1.2)\big)$$
  $$\theta_3(\text{time}) = \operatorname{normalizeAngle}\Big(\theta_0 + s \cdot 1.25 - s \cdot \big(0.28 \cdot \text{time} + 0.22 \cos(1.6 \cdot \text{time})\big)\Big)$$

### 1.3 複数デコイの共通処理仕様
- **デコイ判定ヘルパー**: `export function isDecoyTarget(targetId) { return targetId !== 'main'; }`（`'decoy'`, `'decoy2'`, `'decoy3'` すべてがデコイとして扱われる）。
- **ブリップ記録（`recordBlip`）**: `const isDecoy = isDecoyTarget(target.id);` とし、戦術パルス（`source === 'pulse'`）が通過した際は全デコイ（`decoy`, `decoy2`, `decoy3`）に対して `isDecoyEcho = true` を付与する。
- **弾との衝突判定（`stepGame` 内 `SHOT_FLYING`）**:
  `game.targets.filter(t => isDecoyTarget(t.id) && !t.destroyed)` の全デコイに対して線分距離判定を行い、接触したデコイはすべてホログラム破砕（`destroyed = true`, `visibleDirectly = true`, `cpaInfo.decoyHit = true`）させつつ、徹甲弾は減衰せず直進を継続する。

---

## 2. 距離比例スコア計算式（遠距離高得点・接近減点方式）への刷新

### 2.1 スコア設計方針
- **基本原則**: 「敵を遠く（外周 `340px` 付近）で仕留めるほど高得点となり、自機に近づかれるほどスコアが単調減少する。特に危険領域（$r_{\text{impact}} < 120\text{ px}$）まで引き付けると **`DANGER CLOSE PENALTY`** により距離スコアが大幅に減点される」。
- **命中距離 $r_{\text{impact}}$ の定義**:
  命中確定フレーム（`finalizeRoundClear`）における本物の敵（`main`）の中心距離 $r_{\text{impact}} = \text{mainTgt.r}$（フォールバック：$\sqrt{\text{impactX}^2 + \text{impactY}^2}$）。

### 2.2 ラウンド別スコア算出式（最大 `10,000 pts`）

1. **距離迎撃スコア（`distanceScore` / 後方互換のため `baseScore` にも同値を格納：最大 `6,000 pts`、最小 `300 pts`）**:
   - **通常・遠距離域（$r_{\text{impact}} \ge 120\text{ px}$）**:
     $$u = \operatorname{clamp}\left(\frac{r_{\text{impact}} - 120}{340 - 120}, \; 0, \; 1\right) = \operatorname{clamp}\left(\frac{r_{\text{impact}} - 120}{220}, \; 0, \; 1\right)$$
     $$\text{distanceScore} = \operatorname{round}\big(2000 + 4000 \cdot u\big) \quad (2,000\text{ 〜 }6,000\text{ pts})$$
   - **危険接近域（$r_{\text{impact}} < 120\text{ px}$：`DANGER CLOSE PENALTY` 発動）**:
     $$u_{\text{danger}} = \operatorname{clamp}\left(\frac{r_{\text{impact}} - 34}{120 - 34}, \; 0, \; 1\right) = \operatorname{clamp}\left(\frac{r_{\text{impact}} - 34}{86}, \; 0, \; 1\right)$$
     $$\text{distanceScore} = \operatorname{round}\big(300 + 900 \cdot u_{\text{danger}}^2\big) \quad (300\text{ 〜 }1,200\text{ pts})$$
   - *距離別スコア推移例*:
     - $r_{\text{impact}} \ge 340\text{ px}$: `6,000 pts`
     - $r_{\text{impact}} = 280\text{ px}$: `4,909 pts`（`LONG-RANGE SNIPE!`）
     - $r_{\text{impact}} = 240\text{ px}$: `4,182 pts`（`LONG-RANGE SNIPE!` 境界）
     - $r_{\text{impact}} = 180\text{ px}$: `3,091 pts`（中距離標準）
     - $r_{\text{impact}} = 120\text{ px}$: `2,000 pts`（危険域境界）
     - $r_{\text{impact}} = 90\text{ px}$: `682 pts`（`DANGER CLOSE PENALTY` 大幅減点）
     - $r_{\text{impact}} = 40\text{ px}$: `304 pts`（コア直前）

2. **精密射撃ボーナス（`precisionBonus`：最大 `1,500 pts`）**:
   $$\text{precisionBonus} = \operatorname{round}\left(\left(1 - \frac{\operatorname{clamp}(\text{hitOffsetPx}, 0, 22)}{22.0}\right) \times 1500\right)$$

3. **暗闇予測ボーナス（`blindBonus`：最大 `1,500 pts`）**:
   $$\text{blindBonus} = \operatorname{clamp}\left(\operatorname{round}\left(\frac{\Delta t_{\text{blind}}}{1.20} \times 1500\right), \; 0, \; 1500\right)$$

4. **戦術パルス温存ボーナス（`noPingBonus`：`1,000 pts`）**:
   - `tacticalPingRemaining > 0` の場合 `+1,000 pts`、使用済みの場合 `+0 pts`。

5. **合計ラウンドスコア**:
   $$\text{totalRoundScore} = \text{distanceScore} + \text{precisionBonus} + \text{blindBonus} + \text{noPingBonus}$$

### 2.3 距離称号フラグと `lastResult` 追加プロパティ
`finalizeRoundClear` で生成する `game.lastResult` に以下のプロパティを含める（既存プロパティも全て維持）：
- `impactRadiusPx`: `Math.round(r_impact)`（命中時の敵中心距離 px）
- `distanceScore`: 上記で算出した距離迎撃スコア（`baseScore` にも同じ値を格納）
- `isLongRangeSnipe`: `r_impact >= 240`（`true` の場合、リザルト画面に **`LONG-RANGE SNIPE!`** 称号バッジを表示）
- `isDangerClose`: `r_impact < 120`（`true` の場合、リザルト画面に **`DANGER CLOSE PENALTY`** 警告バッジを表示）
- `isBullseye`: `Math.round(clampedOffset) <= 6`（**`BULLSEYE!`** 称号）
- `isBlindSnipe`: `blindTime >= 0.80`（**`BLIND SNIPE!`** 称号）

### 2.4 ラウンド別ランク閾値 ＆ 全10ラウンド総合ランク閾値（`getOverallRank`）

| ランク | ラウンド単体スコア条件 | 全10ラウンド総合スコア条件（`getOverallRank(totalScore)`） |
| :--- | :--- | :--- |
| **RANK S** | `7,500 pts` 以上（遠距離〜中遠距離での高精度撃破が必須） | `70,000 pts` 以上 |
| **RANK A** | `5,500 〜 7,499 pts`（中距離での安定撃破） | `50,000 〜 69,999 pts` |
| **RANK B** | `5,499 pts` 以下（危険域 `r < 120px` まで引き付けた場合は必ずB以下） | `49,999 pts` 以下 |

---

## 3. 追加受け入れテスト項目（AT-12・AT-13）および既存テスト更新

- **AT-10 の更新**: 全5ラウンドから **全10ラウンド（Round 1〜10）クリア後に `state === 'ALL_CLEAR'` へ到達すること** に拡張する。
- **新規追加テスト（AT-12, AT-13）**:

| ID | テスト項目 | 実行手順（自動スクリプト） | 合格条件（アサーション） |
| :--- | :--- | :--- | :--- |
| **AT-12** | **Round 6〜10（WAVE 2）の軌道アルゴリズムと複数デコイ検証** | Round 6〜10 を順次 `startRound(r, 0.4)` で開始してステップ進行させ、以下を検証する。<br>1. R6: $r=190\text{px}$ 付近の前後で進行方位ベクトル（`heading`）が折れ曲がること。<br>2. R7: 経過時間に伴い角速度が増加すること。<br>3. R8: $t=5.0\text{s}$ ($r \le 240\text{px}$) 以降で `isBoosted === true` かつ急加速・角度シフトが発生すること。<br>4. R9: `targets.length === 2`（2.2秒周期スラローム＋デコイ1機）であること。<br>5. R10: `targets.length === 4`（`main`, `decoy`, `decoy2`, `decoy3`）であり、`triggerTacticalPing()` 実行後に3機のデコイすべてのブリップに `isDecoyEcho === true` が記録されること。 | Round 6〜10 の全軌道とターゲット数（R9で2機、R10で4機）、および戦術パルスによる全デコイ一斉識別が仕様通りに動作すること。 |
| **AT-13** | **距離比例スコア（遠距離高スコア／接近時大幅減点）の検証** | 同一ラウンド（例：Round 1）において、<br>ケースA：敵が遠距離（$r_{\text{impact}} \ge 250\text{px}$、$t \approx 2.0\text{s}$）にいる時点で命中させる。<br>ケースB：敵が中距離（$r_{\text{impact}} \approx 170\text{px}$、$t \approx 6.0\text{s}$）にいる時点で命中させる。<br>ケースC：敵を危険域内（$r_{\text{impact}} < 120\text{px}$、$t \approx 10.0\text{s}$）まで引き付けてから命中させる。 | 1. `score(A) > score(B) > score(C)` および `distanceScore(A) > distanceScore(B) > distanceScore(C)` が厳密に成立すること。<br>2. ケースAで `lastResult.isLongRangeSnipe === true` となること。<br>3. ケースCで `lastResult.isDangerClose === true` かつ `lastResult.distanceScore <= 1200`、`lastResult.rank === 'B'` に抑えられること。 |