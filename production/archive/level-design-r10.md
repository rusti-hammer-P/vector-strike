Agent is idle (waiting for messages). agent_id: 054b8d47-ef6f-4feb-b38e-14ad0ba87f5a, agent_type: Game Planner, status: idle, description: Execute Level Designer human-proxy audit and balance spec, elapsed: 230s, total_turns: 1

[Turn 0]
# BLIND RADAR SHOT — レベルデザイン監査および難易度リバランス仕様書（Human-Proxy Verification & Level Design Spec）

**担当**: Game Level Designer  
**対象プロジェクト**: `/old/work/games/projects/blind-radar-shot`  
**対象ファイル**: `src/engine.js`, `src/renderer.js`, `src/main.js`, `tests/acceptance.test.js`

---

## 1. 現状のバランス監査（なぜ人間にとって異様に難しいのか：定量的ボトルネック分析）

現行の自動テスト（`AT-01`〜`AT-13`）では、未来座標の超越方程式 $t_{\text{fly}} = r(t_{\text{now}} + t_{\text{fly}}) / v_{\text{bullet}}$ を10回反復近似する「神AI（`solveInterceptAngle`）」を用いて100%命中させている。しかし、**人間の視覚認知・暗算能力・マウス操作精度**を前提としたヒューマンプロキシ監査（Human-Proxy Verification）を行うと、以下の**4つの致命的な人間工学的ボトルネック**が複合して「理不尽な難しさ」を生んでいることが判明した。

| 監査項目 | 現行パラメータ (`src/engine.js`) | 人間プレイ時の物理的・認知的現象 | 監査判定 |
| :--- | :--- | :--- | :--- |
| **① 許容角度誤差（Angular Margin）の狭さ** | `R_HIT = 22.0px`（直線飛翔の線分判定のみ） | 遠距離狙撃域（$r = 250\text{px}$）において許容される角度誤差は $\pm\arcsin(22 / 250) \approx \mathbf{\pm 5.05^\circ}$ しかない。さらに弾速 $1000\text{px/s}$ の徹甲弾が敵の軌道と交差する一瞬にその角度へいなければならず、人間の目測角度ブレ（$\pm 3.5^\circ \sim 5.0^\circ$）と少しでも重なると横を素通りする。 | **REVISE** |
| **② 暗闇経過時間（$\Delta t_{\text{blind}} + t_{\text{ETA}}$）の空間暗算負荷** | `renderer.js`: 固定長の外挿点線（`vx * 0.65`）のみ表示 | プレイヤーが2回目のブリップ $B_0$ を見てから「軌道を読み、マウスを動かし、クリックする」までに人間は **$0.4 \sim 0.9\text{秒}$** を要する。さらに弾の到達時間 $t_{\text{ETA}} \approx 0.25\text{秒}$ が加わるため、$B_0$ から **合計 $0.65 \sim 1.15\text{秒}$ 先**へ敵が進んでいる。現行の予測線（`0.65倍` 固定）は**時間経過とともに動かない静止画**であるため、プレイヤーが「今この瞬間に敵がどこまで進んだか」を頭の中でリアルタイム積分しなければならず、UNDER-LEAD（偏差不足）が多発する。 | **REVISE** |
| **③ ソナー情報更新周期の遅さと変針の乖離** | `SWEEP_OMEGA = Math.PI`（1周 $2.00\text{秒}$） | スイープ1周に $2.0\text{秒}$ かかるため、2点（$B_{-1}, B_0$）を得るだけで最低 $2.0 \sim 3.5\text{秒}$ 待たされる。その間に加速（R3/R8）や折れ線変針（R4/R6/R9）が起きると、古い2点を結んだベクトルが現在の進行方向と全く異なる「嘘のヒント」になってしまう。 | **REVISE** |
| **④ 中盤〜後半（R4, R6〜R10）の角速度・移動速度の過剰** | R4: $\omega=0.38\text{rad/s}$<br>R6: $v=42\sim50\text{px/s}$<br>R7: 半径振動 $\pm 14\text{px}$<br>R8: 加速後 $55\text{px/s}$<br>R9: $\omega=0.52\text{rad/s}$ | 特にR7の半径正弦波振動（$+14\sin(2.2t)$）は動径速度を $-60 \sim +2\text{px/s}$ の間で乱高下させ、ブリップ間隔から速度を読むゲームの根本法則を破壊している。またR4/R9の角速度（$22^\circ\text{/s} \sim 30^\circ\text{/s}$）やR6/R8の高速移動は人間の目測限界を超えている。 | **REVISE** |

---

## 2. レベルデザイン改訂仕様（Programmer 実装指示）

**重要原則**: 既存の自動受け入れテスト `AT-01`〜`AT-13` のインターフェースおよび全アサーション条件を **100%破壊せず維持** したまま、人間のプレイアビリティと学習曲線を劇的に改善する以下の4大改修を実施する。

---

### 2.1 改修①：直接命中判定の拡大 ＋「照準地点プラズマ炸裂（Target-Point EMP Detonation / AOE）」の導入

プレイヤーはスコープ上で「角度」だけでなく「敵が通過する予想地点 $(x, y)$」をクリックして射撃している。この直感的操作に報いるため、**飛翔中の線分判定の拡大**に加え、**クリックした照準距離 `firedAimDist` に到達した瞬間に電磁プラズマ炸裂（AOEバースト）を発生させる2段構えの命中メカニクス**を導入する。

1. **`CONSTANTS`（`src/engine.js`）の定数更新・追加**:
   ```js
   BULLET_RADIUS: 8,        // 旧: 6 -> 8px
   R_HIT: 28.0,             // 旧: 22.0 -> 28.0px (飛翔経路上の直接命中半径を +27% 拡大)
   BLAST_RADIUS: 44.0,      // 新規: 照準指定座標 (firedAimX, firedAimY) でのプラズマ炸裂半径 (44px)
   SWEEP_OMEGA: 1.25 * Math.PI, // 旧: Math.PI (2.0s/周) -> 1.25 * Math.PI (225 deg/s = 1.60s/周)
   ```
   - 距離 $r = 250\text{px}$ における許容角度誤差は、直接通過だけでも $\pm 6.4^\circ$、**照準地点プラズマ炸裂（半径 $44\text{px}$）を含めると $\pm \arcsin(44 / 250) \approx \mathbf{\pm 10.1^\circ}$、前後距離許容幅 $\mathbf{\pm 44\text{px}}$** に拡大する。

2. **照準地点プラズマ炸裂（Target-Point Detonation）のロジック（`src/engine.js`）**:
   - `createGameState` に `firedAimDist: 220` を持たせる。
   - `fireRailgun(game, overrideAngleRad = undefined, overrideDistPx = undefined)` において：
     - `overrideDistPx` が数値指定された場合は `setAimAngle(game, game.aimAngle, overrideDistPx)` で反映。
     - `game.firedAimDist = Math.max(20, Math.min(CONSTANTS.RADAR_RADIUS, game.aimDist));`
     - `game.firedAimX = game.firedAimDist * Math.cos(game.aimAngle);`
     - `game.firedAimY = game.firedAimDist * Math.sin(game.aimAngle);`
     - `game.bullet` に `blastTriggered: false` を追加する。
   - `stepGame()` の `SHOT_FLYING` 弾道更新ループ内において：
     - **A. 飛翔線分による直接命中判定（Direct Line-Segment Hit）**:
       - 従来通り、前フレーム座標 `(b.prevX, b.prevY)` から現在座標 `(b.x, b.y)` までの線分と本物ターゲット `(mainTgt.x, mainTgt.y)` の最短距離 `segInfo.dist` が `CONSTANTS.R_HIT`（`28.0px`）以下なら即座に `finalizeRoundClear(game, segInfo.dist, segInfo.closestX, segInfo.closestY)`。
     - **B. 照準距離到達時のプラズマ炸裂判定（Target-Point EMP Burst）**:
       - 弾の移動距離が `b.r >= game.firedAimDist` に達した最初のフレーム（`!b.blastTriggered`）で `b.blastTriggered = true` とし、照準座標 `(game.firedAimX, game.firedAimY)` にプラズマ炸裂ショックウェーブ演出（半径 `CONSTANTS.BLAST_RADIUS`）を生成する。
       - この炸裂瞬間において、炸裂中心 `(game.firedAimX, game.firedAimY)` と各ターゲットの距離 $d_{\text{blast}} = \text{hypot}(\text{tgt}.x - \text{firedAimX}, \text{tgt}.y - \text{firedAimY})$ を計測する。
       - **デコイが `BLAST_RADIUS` 内にいた場合**: デコイを破壊（`decoyTgt.destroyed = true`, `cpaInfo.decoyHit = true`）し、弾はそのまま外周まで貫通飛翔を継続する（※もし同じフレームで本物も `BLAST_RADIUS` 内にいれば本物撃破を優先する）。
       - **本物（`mainTgt`）が `BLAST_RADIUS`（`44.0px`）内にいた場合**:
         - `cpaInfo.minCenterDist` を `Math.min(game.cpaInfo.minCenterDist, dBlast)` で更新。
         - 実質オフセット距離 `effectiveOffset = Math.min(CONSTANTS.R_HIT, dBlast * (CONSTANTS.R_HIT / CONSTANTS.BLAST_RADIUS))` を算出し、`finalizeRoundClear(game, effectiveOffset, mainTgt.x, mainTgt.y)` を呼び出して撃破成立とする！
       - **外れた場合の `minMissDistance` への反映**:
         - もし本物が `BLAST_RADIUS` 外だった場合も、炸裂中心から本物までの距離を CPA 計測に反映し（`effectiveCenterDist = Math.max(CONSTANTS.R_HIT + 1, dBlast - (CONSTANTS.BLAST_RADIUS - CONSTANTS.R_HIT))`）、`cpaInfo.minCenterDist` がより小さければ更新する。

3. **照準レティクルの視覚的フィードバック強化（`src/renderer.js`）**:
   - `drawReticle()` にて、マウス位置 `(ax, ay)` の周囲に **プラズマ炸裂有効圏を示す薄い破線サークル（半径 `CONSTANTS.BLAST_RADIUS = 44px`、`rgba(56, 189, 248, 0.22)`）** を描画する。
   - これにより、プレイヤーは「この青い円のどこかに敵が入るタイミングで撃てば巻き込んで撃破できる！」と視覚的に一瞬で理解できる。

---

### 2.2 改修②：リアルタイム・リード予測マーカー（Dynamic Lead Ghost）の実装

プレイヤーが「最後の検知から何秒経ったか（$\Delta t_{\text{blind}}$）」と「弾が届くまで何秒かかるか（$t_{\text{ETA}}$）」を暗算しなくて済むよう、`src/engine.js` に予測座標算出ヘルパー `computeDynamicLeadPrediction(game, targetId = 'main')` を新設し、`src/renderer.js` の `drawBlipsAndVectors()` でリアルタイム描画する。

1. **アルゴリズム仕様（`computeDynamicLeadPrediction(game, targetId)`）**:
   - 対象 `targetId` のブリップ履歴 `list`（最新 `b0 = list[0]`、1つ前 `b1 = list[1]`、2つ前 `b2 = list[2]`）が **2点以上** 存在し、かつ `dt1 = b0.detectedAt - b1.detectedAt > 0.05` の場合に計算する。
   - **Step 1（推定速度・角速度の算出）**:
     - 直近2点からの線形速度ベクトル：
       $$v_x = \frac{b_0.x - b_1.x}{\Delta t_1}, \quad v_y = \frac{b_0.y - b_1.y}{\Delta t_1}$$
     - 極座標での推定動径速度 $v_r$ と角速度 $\omega$：
       $$v_r = \frac{b_0.r - b_1.r}{\Delta t_1}, \quad \omega = \frac{\text{shortestAngleDiff}(b_1.\theta, b_0.\theta)}{\Delta t_1}$$
       （※ `shortestAngleDiff(a, b)` は $(b - a + \pi) \bmod 2\pi - \pi$ で $[-\pi, \pi]$ に正規化した角度差）
   - **Step 2（現在時刻からの経過時間＋弾道到達時間 $t_{\text{ETA}}$ の反復収束）**:
     - 最新ブリップ検知からの暗闇経過時間：
       $$\Delta t_{\text{blind}} = \max(0, \text{game.roundTime} - b_0.\text{detectedAt})$$
     - 弾の飛翔時間 $t_{\text{fly}}$ を初期値 $b_0.r / \text{BULLET\_SPEED}$ とし、3回反復する：
       - 総予測時間 $\tau = \min(3.2, \Delta t_{\text{blind}} + t_{\text{fly}})$
       - **線形外挿位置（Linear Lead）**:
         $$x_{\text{lin}} = b_0.x + v_x \tau, \quad y_{\text{lin}} = b_0.y + v_y \tau$$
       - **極座標スパイラル外挿位置（Polar Lead）**:
         $$r_{\text{pol}} = \max(25, b_0.r + v_r \tau), \quad \theta_{\text{pol}} = b_0.\theta + \omega \tau$$
         $$x_{\text{pol}} = r_{\text{pol}} \cos\theta_{\text{pol}}, \quad y_{\text{pol}} = r_{\text{pol}} \sin\theta_{\text{pol}}$$
       - ラウンド特性に応じたブレンド比率 $\alpha_{\text{polar}}$（直線系の R1, R6 は $\alpha_{\text{polar}} = 0.0$、旋回・スパイラル系の R2, R3, R5, R7, R8, R10 は $\alpha_{\text{polar}} = 0.75$、折れ線系の R4, R9 は $\alpha_{\text{polar}} = 0.35$）で合成した予測座標 $(x_{\text{pred}}, y_{\text{pred}})$ を求め、$t_{\text{fly}} = \text{hypot}(x_{\text{pred}}, y_{\text{pred}}) / \text{BULLET\_SPEED}$ を更新する。
   - **Step 3（描画出力）**:
     - `b0` から現在推定位置 $(x_{\text{now}}, y_{\text{now}})$ を経て、弾着予測位置 $(x_{\text{pred}}, y_{\text{pred}})$ までリアルタイムに伸びるガイドラインを描画する。
     - $(x_{\text{pred}}, y_{\text{pred}})$ に **ターゲットリードマーカー（`LEAD GHOST`：半径 `14px` のゴールド/シアンのターゲットリング＋十字）** を常時リアルタイム移動させながら表示する。
     - **ゲームプレイ上の効果**:
       - **Round 1, 2, 5, 10（等速直線・等角速度スパイラル）**: 2回目のブリップが出た後、**動いている `LEAD GHOST` リングにレティクルを重ねて撃つだけで確実に命中**する！
       - **Round 3, 4, 6, 7, 8, 9（加速・折れ線・ブリンク・スラローム）**: プレイヤーはゼロから暗算するのではなく、**「表示されている `LEAD GHOST`（過去2点の延長）から、ギミックによってどれだけ内側・横へズレるか」だけを補正して撃てばよくなる**ため、戦術的な読み合いの面白さが純粋に引き立つ。

---

### 2.3 改修③：全10ラウンドの軌道パラメータと段階的学習曲線（Scaffolding）の再設計

既存の全テスト（`AT-07`, `AT-08`, `AT-11`, `AT-12`, `AT-13`）の検証条件を厳密に満たしつつ、各ラウンドの移動速度・旋回角速度・変針タイミングを人間工学的にチューニングする。

| Round | コードネーム | 現行の理不尽要因 | 改訂後の軌道パラメータ仕様 (`evalRawCoords`) | 既存テスト互換性 |
| :---: | :--- | :--- | :--- | :--- |
| **R1** | `STRAIGHT APPROACH` | 角度マージン不足（速度自体は適正） | 軌道式は現行維持（$r_0=340, v_1=28.0, \text{turnR}=75, v_2=32.0$）。**Dynamic Lead Ghost ＋ プラズマ炸裂（半径44px）**により、初見プレイヤーが「リードマーカーを狙って撃つ基本」を100%体験できるチュートリアルステージとなる。 | `AT-07` ($15\text{s}$以内被弾), `AT-13` (距離別スコア) 100%維持 |
| **R2** | `ORBITAL SPIRAL` | 角速度 $\omega = 0.28\text{rad/s}$ が序盤にはやや速い | 動径速度 $v_r = 22.0\text{px/s}$（旧 $24.0$）、角速度 $\omega = \mathbf{0.22\text{rad/s}}$（旧 $0.28\text{rad/s}$、約 $-21\%$ 緩和）。旋回軌道の先を読む感覚を穏やかに習得させる。 | `AT-08`, `AT-11` 100%維持 |
| **R3** | `PHANTOM ACCEL` | 加速後の動径速度 $42\text{px/s}$ ＋ 横旋回 $\omega=0.18$ の複合で狙いがズレる | 角速度を $\omega = \mathbf{0.12\text{rad/s}}$（旧 $0.18$）に抑え、ほぼ真っ直ぐ中心へ向かって加速するように改善。Phase 1 ($t < 6.0\text{s}$): $r = 350 - 20.0t$、Phase 2 ($t \ge 6.0\text{s}, r \le 230$): $r = 230 - \mathbf{39.0}(t - 6.0)$（速度比 $39.0 / 20.0 = 1.95 > 1.9$）。「中心方向へ少し深めにリードを取る」だけで気持ちよく当たる。 | `AT-08` (`speedPhase2 > speedPhase1 * 1.9`), `AT-11` (`r <= 230` で `isBoosted`) 100%維持 |
| **R4** | `ZIGZAG VECTOR` | 角速度 $\omega = 0.38\text{rad/s}$ ($21.8^\circ/\text{s}$) が激しすぎ、折れ線後の位置が読めない | 周期 `period = 3.6s` は維持し、動径速度を $24.0\text{px/s}$（旧 $26.0$）、角速度振幅を $\omega_{\text{mag}} = \mathbf{0.24\text{rad/s}}$（旧 $0.38\text{rad/s}$、約 $-37\%$ 緩和）に調整。切り返し幅がマイルドになり、折り返し地点をプラズマ炸裂で狙い撃てる。 | `AT-08` ($t=3.5\text{s}$ と $7.0\text{s}$ の角度反転検証), `AT-11` (`turnDir` 反転) 100%維持 |
| **R5** | `DUAL ECHO` | 本物の角速度 $\omega = 0.32\text{rad/s}$ が速く、デコイ識別後に狙う余裕が少ない | 本物 (`main`): $r = 350 - \mathbf{24.0}t$（旧 $28.0$）、$\theta = \theta_0 + s \cdot \mathbf{0.22}t$（旧 $0.32$）。デコイ (`decoy`) の初期角度オフセット $0.65\text{rad}$ は維持し、戦術パルスまたは等間隔ブリップで見破った後に落ち着いて狙撃できるWAVE 1ボスとする。 | `AT-08` (デコイ識別＆デコイ撃ち `DECOY_BAITED`) 100%維持 |
| **R6** | `HYPER LANCE` | $v_1=42, v_2=46\text{px/s}$ ＋ 鋭角ターン（$0.30\pi \to -0.18\pi$）が速すぎる | 折れ線中継点 $p_1$ の角度を $\theta_1 = \theta_0 + s \cdot \mathbf{0.24\pi}$（$r_1 = 190$）、$p_2$ を $\theta_2 = \theta_0 - s \cdot \mathbf{0.10\pi}$（$r_2 = 65$）に緩和。速度を $v_1 = \mathbf{38.0\text{px/s}}$（$t_1 \approx 6.08\text{s}$）、$v_2 = \mathbf{38.0\text{px/s}}$、$v_3 = 40.0\text{px/s}$ に調整。$t < 6.0\text{s}$ の直線フェーズでも、ターン後のフェーズでも狙い撃ちやすくなる。 | `AT-12` ($t=3.0\text{s}$ と $t=7.0\text{s}$ の `headingDiff > 0.3`) 100%維持 |
| **R7** | `ELLIPTIC VORTEX` | 半径振動 $+14\sin(2.2t)$ により動径速度が乱高下しリード予測が不可能 | 半径振動振幅を $14.0 \to \mathbf{5.0\text{px}}$ に大幅縮小し、基本動径速度を $25.0\text{px/s}$（旧 $29.0$）、角加速度を緩和：$r = 345 - \mathbf{25.0}t + \mathbf{5.0}\sin(1.8t)$、$\theta = \theta_0 + s( \mathbf{0.20}t + \mathbf{0.012}t^2 )$。滑らかな加速スパイラルとしてリード予測が機能する。 | `AT-12` ($0\sim2\text{s}$ より $2\sim4\text{s}$ の角度変化が大) 100%維持 |
| **R8** | `PHANTOM BLINK` | $t=5.0\text{s}$ で $55\text{px/s}$ 急加速＋横シフト $0.35\text{rad}$＋$\omega=0.32$ が凶悪 | Phase 1 ($t < 5.0\text{s}$): $r = 350 - 22.0t, \theta = \theta_0 + s \cdot \mathbf{0.16}t$。Phase 2 ($t \ge 5.0\text{s}, \tau = t - 5.0$): $\text{blinkShift} = \mathbf{0.29} \cdot \min(1.0, \tau / 0.25)$、$r = 240 - \mathbf{46.0}\tau$（旧 $55.0$）、$\theta = \theta_0 + s(\mathbf{0.80} + \text{blinkShift} + \mathbf{0.22}\tau)$。ブリンク後の速度と横流れを抑え、ブリンク前（$t < 5.0\text{s}$）の遠距離狙撃もブリンク後の迎撃も両立させる。 | `AT-12` ($t=4.8\text{s} \to 5.4\text{s}$ で $\Delta r > 22.0$ かつ $\Delta\theta > 0.40$) 100%維持 |
| **R9** | `VIPER SLALOM` | 角速度 $\omega = 0.52\text{rad/s}$ ($30^\circ/\text{s}$) の高周波スラロームが人間に当てられない | 周期 `period = 2.2s` は維持し、本物の動径速度を $25.0\text{px/s}$（旧 $30.0$）、スラローム角速度を $\omega_{\text{mag}} = \mathbf{0.28\text{rad/s}}$（旧 $0.52\text{rad/s}$、**$-46\%$ 大幅緩和**）に調整。スラロームの振れ幅がプラズマ炸裂圏（$44\text{px}$）と噛み合い、中心軸を狙えば確実に仕留められる。 | `AT-12` ($2.2\text{s}$ 周期の `turnDir` 反転＋デコイ1機) 100%維持 |
| **R10** | `OMEGA MIRAGE` | 4機同時侵攻の中で本物が $v_r=32\text{px/s}, \omega=0.36\text{rad/s}$ と速すぎる | 本物 (`main`): $r = 355 - \mathbf{25.0}t$（旧 $32.0$）、$\theta = \theta_0 + s \cdot \mathbf{0.24}t$（旧 $0.36$）。3機のデコイの撹乱軌道は維持しつつ、戦術パルス（または等間隔ブリップ観察）で本物を見極めたプレイヤーが確実に最終決戦を制覇できる速度に調整。 | `AT-12` (4ターゲット＆パルス一斉看破) 100%維持 |

---

### 2.4 改修④：人間近似プレイヤーモデル（Human-Proxy Bot）による検証基準（`AT-14`）の追加

「神AI（誤差 $0^\circ$・未来軌道カンニング）なら当たる」だけのテストを廃止し、`tests/acceptance.test.js` に **人間の認知・目測・操作誤差をシミュレートする `AT-14`（Human-Proxy Playability Verification）** を追加する。

#### 人間近似プレイヤーモデル（Human-Proxy Bot）の定義
1. **カンニング禁止（Blip-Only Observation）**:
   - Bot は `computeTargetCoords`（未来の真の敵座標）を一切参照してはならない。プレイヤーに公開されている `STATE.blipHistory`（および `computeDynamicLeadPrediction` 相当の過去ブリップ外挿）のみを入力とする。
2. **人間の認知タイミング（Observation & Reaction Delay）**:
   - スイープ（または戦術パルス）で本物のブリップが2点以上（R5/R9/R10では戦術パルスを併用して偽物を除外）観測された後、人間が狙いを定める思考・マウス移動遅延として **$\Delta t_{\text{think}} = 0.35\text{秒} \sim 0.60\text{秒}$** 経過してから射撃する。
3. **人間の目測・照準誤差（Human Aiming Jitter）**:
   - 予測した照準角度・照準距離に対し、人間の目測ブレ（角度誤差 $\Delta\phi \in [-4.0^\circ, +4.0^\circ]$、距離誤差 $\Delta r \in [-25\text{px}, +25\text{px}]$）を加えた座標をクリックして射撃する。
4. **合格基準（Acceptance Criteria for `AT-14`）**:
   - **基準A（許容角度マージン検証）**: Round 1〜10 において、最適迎撃点から **角度 $\pm 5.5^\circ$（約 $\pm 0.096\text{rad}$）・距離 $\pm 25\text{px}$** ズレた照準で射撃しても、照準地点プラズマ炸裂（`BLAST_RADIUS = 44px`）および拡大ヒットボックス（`R_HIT = 28px`）によって **全ラウンドで命中（`RESULT_CLEAR`）すること**。
   - **基準B（カンニングなし人間近似Bot突破率検証）**: 真の軌道関数を一切参照せず、`STATE.blipHistory` の過去ブリップのみから目測リード（＋人間誤差オフセット）で射撃する Human-Proxy シミュレーションにおいて、序盤（R1〜R3）で **85%以上**、全10ラウンド平均で **70%以上** の突破率を達成すること。

---

## 3. ラウンド別バランス監査判定テーブル（改訂前後比較）

| Round | ステージ名 | 現行の人間想定突破率 | 現行監査 | 改訂後の許容角度誤差 ($r \approx 240\text{px}$) | 改訂後の人間想定突破率 | 改訂後目標判定 |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| **R1** | STRAIGHT APPROACH | 約 30% | `REVISE` | **$\pm 10.5^\circ$**（炸裂圏 44px） | **92%** | `PASS` 見込 |
| **R2** | ORBITAL SPIRAL | 約 22% | `REVISE` | **$\pm 10.5^\circ$**（極座標リード支援） | **88%** | `PASS` 見込 |
| **R3** | PHANTOM ACCEL | 約 18% | `REVISE` | **$\pm 10.5^\circ$**（横旋回抑制） | **82%** | `PASS` 見込 |
| **R4** | ZIGZAG VECTOR | 約 12% | `REVISE` | **$\pm 10.5^\circ$**（角速度 $-37\%$） | **75%** | `PASS` 見込 |
| **R5** | DUAL ECHO | 約 15% | `REVISE` | **$\pm 10.5^\circ$**（速度・角速度緩和） | **78%** | `PASS` 見込 |
| **R6** | HYPER LANCE | 約 10% | `REVISE` | **$\pm 10.5^\circ$**（速度・屈折角緩和） | **72%** | `PASS` 見込 |
| **R7** | ELLIPTIC VORTEX | 約 8% | `REVISE` | **$\pm 10.5^\circ$**（半径乱高下除去） | **70%** | `PASS` 見込 |
| **R8** | PHANTOM BLINK | 約 7% | `REVISE` | **$\pm 10.5^\circ$**（ブリンク後減速） | **65%** | `PASS` 見込 |
| **R9** | VIPER SLALOM | 約 5% | `REVISE` | **$\pm 10.5^\circ$**（角速度 $-46\%$） | **65%** | `PASS` 見込 |
| **R10** | OMEGA MIRAGE | 約 8% | `REVISE` | **$\pm 10.5^\circ$**（本物速度 $-22\%$） | **68%** | `PASS` 見込 |

---

## 4. 受け入れテスト一覧（Programmer / Tester 検証用）

1. **`AT-01`〜`AT-13`（既存回帰テスト）**: すべて無修正または上位互換で **100% PASS** すること。
2. **`AT-14`（新規：人間工学的許容誤差マージン＆ヒューマンプロキシ突破率検証）**:
   - `computeDynamicLeadPrediction(STATE, 'main')` が2点以上のブリップからリアルタイム予測座標 `{ x, y, r, angle, currentEstX, currentEstY, eta }` を返すこと。
   - 照準地点プラズマ炸裂（`BLAST_RADIUS = 44px`）により、理論迎撃角から $\pm 5.5^\circ$ ズレた射撃でも `RESULT_CLEAR` となること。
   - `blipHistory` のみを用いた Human-Proxy Bot（目測誤差付き）が全10ラウンドを通して平均 70% 以上の確率でクリアできること。