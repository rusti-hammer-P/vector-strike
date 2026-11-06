# 『BLIND RADAR SHOT』Round 6〜10（OVERDRIVE）視覚表現 ＆ 距離スコア・リザルトデザイン仕様書

本仕様書は、承認済み追加要件である **① Round 6〜10（WAVE 2: OVERDRIVE / MK-II上位個体 ＆ 複数デコイ伴走）のCanvas視覚表現** と、**②「近づかせるほど点数が下がる（遠距離狙撃ほど高スコア）」距離スコア・リザルト仕様** を定義する。

> **UI更新（2026-11-05）**: 初見プレイ向けの整理により、以下の2.2・2.3節にある戦闘中の距離スコア表示は廃止。距離スコアはリザルトに集約し、現行の情報階層・ガイド・角度位相監査は [playability-followup.md](./playability-followup.md) を参照。

---

## 1. Round 6〜10（WAVE 2: OVERDRIVE / MK-II 個体）の視覚表現仕様

### 1.1 基本カラーパレット＆オーバードライブ識別原則
- **対象ラウンド判定**: `const isOverdrive = (b.round || game.round) >= 6;` （アンベール時は `const isOverdrive = game.round >= 6;`）
- **系統マッピング（`getTargetShapeType(round, targetId)`）**:
  - デコイ（`targetId.startsWith('decoy')` または `targetId !== 'main'`）: `'hologram_prism'`
  - Round 1 / Round 6 (`(round - 1) % 5 === 0`): `'delta_lance'`
  - Round 2 / Round 7 (`(round - 1) % 5 === 1`): `'crescent_wing'`
  - Round 3 / Round 8 (`(round - 1) % 5 === 2`): `'twin_thruster'`
  - Round 4 / Round 9 (`(round - 1) % 5 === 3`): `'sidewinder'`
  - Round 5 / Round 10 (`(round - 1) % 5 === 4`): `'stealth_dreadnought'`
- **OVERDRIVE（R6〜R10）共通カラーアクセント**:
  - **ブリップ最新点 (`idx === 0`)**:
    - 通常主線 `glowColor`: `#00F0FF`（ハイパーシアン / DANGER時は `#FF2A55`）
    - サブ外郭・強化カナード・エネルギーリング色 `overdriveAccent`: `#A855F7`（オーバードライブ・バイオレット）または `#FF3366`（クリムゾンエッジ）
    - ソナー波紋（`age < 0.85`）: R6〜R10では外側波紋（`#00F0FF`）に加え、半径 `ripR * 0.68` の**内側セカンダリ波紋（`rgba(168, 85, 247, ripAlpha * 0.8)`）の二重波紋**を描画する。
  - **アンベール時シルエット (`drawEnemySilhouette`)**:
    - 機体メイン外郭線: `#FF3366`（線幅 `2.2px`）、塗りは `rgba(168, 85, 247, 0.28)`
    - MK-II 強化装甲・二重外郭・前進翼アクセント線: `#00F0FF`（線幅 `1.5px`）
    - コア・スパイン発光部: `#FFFFFF` ＋ `#FFD166`

---

### 1.2 5系統の強化型ブリップ（`drawBlipShape`）＆ 強化型シルエット（`drawEnemySilhouette`）座標定義

各図形はローカル座標系（重心 `(0, 0)`、進行方向 `heading` が `+X` 軸、スケール係数 `s`）で描画する。R1〜R5のベース形状を描画した上で、`isOverdrive === true` の場合に以下の **MK-II 強化ディテール** を追加描画する。

#### ① Round 6（R1上位）: `delta_lance` — **HYPER LANCE MK-II（前進カナード＋二重槍外郭）**
- **ブリップ追加描画 (`isOverdrive`)**:
  - **前進カナード翼（左右一対）**:
    - `(3.5*s, -2.5*s) -> (7.5*s, -7.5*s) -> (1.5*s, -4.5*s)` および Y反転 `(3.5*s, 2.5*s) -> (7.5*s, 7.5*s) -> (1.5*s, 4.5*s)`（`strokeStyle = idx === 0 ? '#00F0FF' : strokeColor`, `lineWidth = 1.4 * s`）
  - **延長スピアノーズ＆テイルスタビライザー**:
    - 先端から前方へ伸びるランス針 `(11*s, 0) -> (15.5*s, 0)` と後端ジェットピン `(-3.5*s, 0) -> (-10.5*s, 0)`（`strokeStyle = idx === 0 ? '#FF3366' : strokeColor`）
- **アンベールシルエット追加描画 (`isOverdrive`)**:
  - **二重外郭カナード＆外翼シュラウド**（`strokeStyle = '#00F0FF'`, `lineWidth = 1.6`）:
    - 前進カナード: `(8, -2) -> (13, -9) -> (5, -5)` および `(8, 2) -> (13, 9) -> (5, 5)`
    - 外装ツインランス: `(22, 0) -> (-18, 0)` の貫通センタースピアと、後部アフターバーナーV字コーン `(-15, -5) -> (-22, 0) -> (-15, 5)`（`strokeStyle = '#FFD166'`）

#### ② Round 7（R2上位）: `crescent_wing` — **TWIN-CRESCENT INTERCEPTOR（二重三日月翼＋反転デュアルローター）**
- **ブリップ追加描画 (`isOverdrive`)**:
  - **外側オーバーレイ・クレセント（二重三日月外郭）**:
    - `moveTo(-6.5*s, -11*s)` -> `quadCurveTo(13.5*s, 0, -6.5*s, 11*s)`（`strokeStyle = idx === 0 ? '#A855F7' : strokeColor`, `lineWidth = 1.4 * s`）
  - **内周オーバードライブ・コアリング**:
    - 中心 `(1.5*s, 0)` に半径 `3.2*s` の円環（`strokeStyle = idx === 0 ? '#00F0FF' : strokeColor`）
- **アンベールシルエット追加描画 (`isOverdrive`)**:
  - **アウター・クレセントブレード**:
    - `moveTo(4, -19)` -> `quadCurveTo(21, 0, 4, 19)` -> `lineTo(-5, 14)`（`strokeStyle = '#00F0FF'`, `lineWidth = 1.6`）
  - **二重反転ジャイロリング**:
    - 外周リング（半径 `9.5px`, `strokeStyle = '#00F0FF'`, 破線 `[3, 3]`）を追加し、既存の3枚ブレードと逆回転（`-spinBase * 1.4`）する外側3枚サブブレードを描画。

#### ③ Round 8（R3上位）: `twin_thruster` — **PHANTOM OVERDRIVE（前進翼カナード＋5連プラズマジェット＆二重ショックコーン）**
- **ブリップ追加描画 (`isOverdrive`)**:
  - **巡航時 (`!b.isBoosted`)**:
    - 機首左右に先鋭カナード `(4*s, -2*s) -> (8*s, -6*s) -> (1*s, -3.5*s)`（上下対称、`strokeStyle = idx === 0 ? '#00F0FF' : strokeColor`）と、後部予熱ツインスパイク `(-8.5*s, -2.2*s) -> (-12.5*s, -2.2*s)`（上下対称、`#A855F7`）。
  - **加速ブースト時 (`b.isBoosted`)**:
    - 既存の3本ジェットスパイクに加え、**外側2本のプラズマスパイク** `(-5*s, -7.5*s) -> (-16*s, -9.5*s)`（上下対称）を追加した**計5連ジェットスパイク**。
    - 2段目の外側マッハショックコーン `(-14*s, -7.5*s) -> (-21*s, 0) -> (-14*s, 7.5*s)` を `#00F0FF`（`lineWidth = 1.6 * s`）で描画。
- **アンベールシルエット追加描画 (`isOverdrive`)**:
  - 機体外側にラムジェット・サイドポッド `(-2, -8) -> (8, -11) -> (-12, -16)`（上下対称、`strokeStyle = '#00F0FF'`）を追加。
  - アフターバーナー焔（`plumeLen` を `tgt.isBoosted ? 35 : 25` に延長）の内側に `#00F0FF` の高熱プラズマコア焔を重ね描きする。

#### ④ Round 9（R4上位・デコイ1機伴走）: `sidewinder` — **SIDEWINDER MK-II（三重シェブロン＋両舷バイオレット・ベクターフィン）**
- **ブリップ追加描画 (`isOverdrive`)**:
  - **第3のリーディング・シェブロン（三重矢羽根化）**:
    - `(2*s, -6.5*s) -> (13*s, 0) -> (2*s, 6.5*s)`（`strokeStyle = idx === 0 ? '#00F0FF' : strokeColor`, `lineWidth = 1.6 * s`）
  - **反旋回側カウンターフィン発光**:
    - 旋回側（`ySide`）の `#FFD166` カナードに加え、反対側（`-ySide`）にも小型スタビライザー `(2*s, -ySide * 3.5*s) -> (-1*s, -ySide * 7.5*s)` を `#A855F7` で描画。
- **アンベールシルエット追加描画 (`isOverdrive`)**:
  - 機首前方に先鋭スプリット・ノーズ `(15, 0) -> (20, -3.5) -> (12, -3)`（上下対称、`strokeStyle = '#00F0FF'`）と、尾部ベクターノズル `(-15, 0) -> (-20, -4) / (-20, 4)` を追加。

#### ⑤ Round 10（R5上位・デコイ3機伴走）: `stealth_dreadnought` — **AEGIS OVERLORD（二重六角リアクター＋6翼展開ドレッドノート）**
- **ブリップ追加描画 (`isOverdrive`)**:
  - **アウター・オーバーロードシュラウド（二重装甲外郭）**:
    - 先端 `(14.5*s, 0)` から左右外翼 `(3.5*s, -11.5*s) -> (-9.5*s, -9.5*s)`（上下対称）へ広がる外側ステルスフレーム（`strokeStyle = idx === 0 ? '#00F0FF' : strokeColor`, `lineWidth = 1.5 * s`）。
  - **二重六角形（ダブル・ヘキサゴン）リアクターコア**:
    - 既存の `hexR = 4.2 * s` の内側に、30度（`Math.PI / 6`）回転させた外側六角形リング（`hexR2 = 6.5 * s`, `strokeStyle = idx === 0 ? '#FF3366' : strokeColor`, `lineWidth = 1.2 * s`）を重ねる。
- **アンベールシルエット追加描画 (`isOverdrive`)**:
  - 機体周囲にフローティング・シールドブレード（左右 `(-2, -19) -> (10, -12)`、上下対称、`strokeStyle = '#00F0FF'`, `lineWidth = 1.8`）を追加。
  - 中央リアクターを二重六角形（半径 `8.5px` の `#00F0FF` 外周六角形 ＋ 半径 `5.5px` の `#FFFFFF` 内周六角形）と中心クロスヘアで描画。

---

### 1.3 Round 9（デコイ1機）＆ Round 10（デコイ3機）のマルチデコイ描画・看破仕様

#### ① 動的ターゲットグループ処理（`drawBlipsAndVectors` ＆ `drawTruthUnveil`）
- ハードコードされた `['decoy', 'main']` や `game.trajectoryLog.decoy` のみを参照する処理を拡張し、**すべてのデコイID（`'decoy'`, `'decoy2'`, `'decoy3'`）を動的にグループ化・走査**する。
- **描画順序（Zオーダー）**:
  - デコイ群（`'decoy'`, `'decoy2'`, `'decoy3'`）の残像・予測破線・真の軌跡を先に描画し、**最後に必ず本物（`'main'`）を最前面（トップレイヤー）に描画**して、デコイが本物のブリップやラベルを覆い隠さないようにする。
- **デコイ識別インデックス**:
  - `decoyIndex`: `'decoy'` → `#1`、`'decoy2'` → `#2`、`'decoy3'` → `#3`（Round 5 / Round 9 の単一デコイ時は番号省略可、Round 10 の3機伴走時は番号付きで識別性を高める）。

#### ② マルチデコイの視覚処理（通常時 / 戦術パルス看破時 / アンベール時）
- **通常スイープ検出時（未看破 `b.isDecoyEcho === false`）**:
  - 形状は `'hologram_prism'`（4分割プリズム）。
  - Round 10で3機のデコイが交錯しても軌跡の対応が追えるよう、各デコイの位相ジッター周期に個体オフセット（`phaseOffset = decoyNum * 2.1`）を与え、補助破線のアルファを `rgba(34, 211, 238, 0.30)` とする。
- **戦術パルス（Tactical Ping）による一斉看破時（`b.isDecoyEcho === true`）**:
  - 全デコイ（R9は1機、R10は3機すべて）のブリップが **グリッチ・スプリットプリズム ＋ ネオンローズのXクラック（`#FDA4AF` / `#F43F5E`）** に変化する。
  - 各デコイの最新ブリップ（`idx === 0`）の横に以下のラベルを表示する:
    - 単一デコイ（R5 / R9）: `FAKE / DECOY`
    - 複数デコイ（R10）: `FAKE #1`, `FAKE #2`, `FAKE #3`（3機重なり時の文字被りを防ぐためコンパクト化＆個体番号明示）
  - 看破されたデコイの過去残像を結ぶベクトル破線は `rgba(244, 63, 94, 0.40)`（赤ピンク破線）に切り替わり、プレイヤーが「赤ピンク軌道＝すべて偽物、残るシアン/エメラルド軌道＝本物」と0.2秒で視覚的に切り分けられるようにする。
- **アンベール時（`drawTruthUnveil` / `drawEnemySilhouette`）**:
  - `game.trajectoryLog` 内の全デコイキー（`Object.keys(game.trajectoryLog).filter(k => k !== 'main')`）を走査し、スレートグレー破線（`rgba(148, 163, 184, 0.65)`, `setLineDash([5, 5])`）で全デコイの真の軌跡を描画する。
  - 各デコイ機体シルエット横のラベルは単一デコイ時 `DECOY`、R10複数デコイ時は `DECOY #1`, `DECOY #2`, `DECOY #3`（`fillStyle = '#94A3B8'`）とする。

---

## 2. 「近づかせるほど点数が下がる（遠距離狙撃ボーナス）」視覚フィードバック仕様

### 2.1 距離スコア基準（表示連動パラメータ）
敵（`main`）の中心距離 $r$（`34m`〜`350m`）に応じ、遠距離で撃ち抜くほど高得点となり、近づかれるほどリアルタイムに減衰する：
- **距離ボーナス残量（推定値）**:
  - 最新ブリップ距離 $r_{\text{est}}$（未検出時は初期距離 `340m`、またはリアルタイム表示用）に基づき、遠距離上限（例: `r >= 300m` で MAX `+3,000 pts` または倍率 `x1.50`）からコア直前（`r <= 40m` で `+0 pts` / 倍率 `x1.00`）まで連続減衰する。
  - **ロングレンジ狙撃判定（`isLongRangeSnipe`）**: 命中時の距離 `hitDistanceM >= 220`（220m以遠での撃破）。

### 2.2 左HUDパネル：`SONAR TELEMETRY` 内リアルタイム距離スコア減衰ゲージ
左パネル第2ボックス（`SONAR TELEMETRY`）の下部に、敵が迫るにつれて目減りしていく **「RANGE BONUS（距離スコア残量）」行とプログレスバー** を追加する。

#### DOM構造（`index.html` の `SONAR TELEMETRY` セクション末尾に追記）
```html
<div class="telemetry-row range-bonus-row">
  <span class="telemetry-key">RANGE BONUS</span>
  <span id="hud-range-bonus" class="telemetry-val accent-gold">+3,000 pts (LONG)</span>
</div>
<div class="range-decay-track" title="敵が近づくほど距離ボーナスが減衰します">
  <div id="hud-range-bar" class="range-decay-fill" style="width: 100%;"></div>
</div>
```

#### 状態別カラー＆テキスト変化（`syncHudAndOverlays`）
最新メインブリップ距離 `r`（またはスイープ間の推定接近距離）から算出した残量比率 `ratio = clamp((r - 34) / (320 - 34), 0, 1)` に応じて更新する：
1. **LONG RANGE (`r >= 220m` / `ratio >= 0.65`)**:
   - テキスト: `+{estRangeBonus} pts (LONG SNIPE)`
   - バー色・文字色: `#00FFAA`（エメラルド）〜 `#38BDF8`（シアン）グラデーション
2. **MID RANGE (`120m < r < 220m`)**:
   - テキスト: `+{estRangeBonus} pts (DECAYING)`
   - バー色・文字色: `#FFD166`（アンバーゴールド）
3. **DANGER / POINT-BLANK (`r <= 120m`)**:
   - テキスト: `+{estRangeBonus} pts (LOW / DANGER)`
   - バー色・文字色: `#FF3355`（クリムゾン点滅）

### 2.3 レーダースコープ（Canvas）上の距離減衰フィードバック
1. **照準レティクル横のフローティングタグ（`drawReticle`）の拡張**:
   - 現在の `220m / 045°` ＆ `ETA 0.22s` の2行ボックス（高さ `32px` → `44px`、幅 `112px` → `124px` に拡張）の3行目に、**その照準距離で命中させた場合の距離スコア予測** をリアルタイム表示する：
     - `aimDist >= 220`: `RNG +${aimRangeBonus} [LONG!]`（色: `#00FFAA`）
     - `120 < aimDist < 220`: `RNG +${aimRangeBonus}`（色: `#FFD166`）
     - `aimDist <= 120`: `RNG +${aimRangeBonus} [LOW]`（色: `#FF7B7B`）
2. **最新ブリップ横のテレメトリラベル（`drawBlipShape` の `idx === 0`）**:
   - 既存の `${Math.round(b.r)}m (+${age.toFixed(1)}s)` の直下（`b.x + 12, b.y + 6`）に、小さく `9px` モノスペースで現在の距離ボーナス値 `RNG +${blipRangeBonus}`（`r >= 220m` なら `#00FFAA`、`r < 220m` なら `#FFD166`、`r <= 120m` なら `#FF5577`）を表示し、スイープごとに数値が削られていく焦燥感を可視化する。
3. **220m ロングレンジ・スナイプ境界リングの微細ガイド（`drawGridAndRings`）**:
   - 半径 `220px`（`LONG_SNIPE_RADIUS = 220`）に極細のシアン一点鎖線リング（`strokeStyle = 'rgba(56, 189, 248, 0.16)'`, `setLineDash([8, 4, 2, 4])`）を引き、北軸右横に `LONG SNIPE 220m`（`9px`, `rgba(56, 189, 248, 0.45)`）の控えめな戦術マーカーを添える。

### 2.4 アンベール（Canvas命中地点ポップアップ）＆ リザルトバナー＆全クリア画面仕様

#### ① 命中地点のCanvasポップアップ（`drawTruthUnveil` 内 `RESULT_CLEAR` 時）
- 命中座標 `(bx, by)` 上部のポップアップを最大3段で描画する：
  - 1段目（`by`）: `BULLSEYE! (OFFSET: Xpx)` または `DIRECT HIT! (OFFSET: Xpx)`（`#FFD166` / `#00FFAA`）
  - 2段目（`by - 15`）: **`RANGE SCORE: +${res.rangeBonus} pts (${res.hitDistanceM}m)`**
    - `res.isLongRangeSnipe`（`hitDistanceM >= 220`）が `true` の場合は **`LONG-RANGE SNIPE! (${res.hitDistanceM}m / +${res.rangeBonus})`** を `#00F0FF`（シャドウ発光付き）で強調描画！
  - 3段目（`by - 30`、`res.isBlindSnipe` 時）: `BLIND SNIPE! (+${res.blindTime}s)`（`#38BDF8`）

#### ② 下部スリム・リザルトバナー（`#result-detail`）の内訳表記
- `RESULT_CLEAR` 時の `#result-detail` テキストフォーマット：
  - `命中距離: ${res.hitDistanceM}m${res.isLongRangeSnipe ? ' [LONG-RANGE SNIPE!]' : ''} | ズレ: ${res.hitOffsetPx}px | 暗闇経過: ${res.blindTime}s (Range +${res.rangeBonus} / Blind +${res.blindBonus} / Precision +${res.precisionBonus} / No-Ping +${res.noPingBonus})`
- 次ラウンドボタン（`#btn-result-next`）の分岐条件を `game.round < 10`（10ラウンド制対応）に更新する。

#### ③ 左HUDラウンド表記 ＆ 全クリア画面（`#all-clear-overlay`）の10ラウンド対応
- 左HUD `#hud-round-num`:
  - R1〜R5: `ROUND 0${game.round} / 10 [WAVE 1]`
  - R6〜R10: `ROUND ${String(game.round).padStart(2, '0')} / 10 [OVERDRIVE]`（文字色を `#00F0FF` または `#A855F7` 発光に切り替え）
- 全クリア画面（`#all-clear-overlay`）:
  - `.modal-tag`: `ALL 10 TARGETS NEUTRALIZED`
  - `#allclear-breakdown`: 10ラウンド分の行がモーダル高さを溢れさせないよう、**2カラムグリッド（左列 R1〜R5、右列 R6〜R10）** でコンパクトに表示する。各行には `R{n} {codeName}` と `${hitDistanceM}m | RANK ${rk} | ${sc.toLocaleString()} pts` を表示する。

---

## 3. タイトル画面：2段ラウンドダイレクト選択ボタン（R1〜R5 / R6〜R10）レイアウト仕様

タイトルモーダル（`.modal-card`）内の `.round-select-bar` を、**上段 WAVE 1（R1〜R5）** と **下段 WAVE 2: OVERDRIVE（R6〜R10）** の2段グリッド構成に刷新し、`960×720` キャンバス内に美しく収める。

### 3.1 HTML構造（`index.html` 内 `.round-select-bar` 置き換え仕様）
```html
<div class="round-select-panel">
  <div class="round-wave-row">
    <span class="wave-label wave-1">WAVE 1 // STANDARD:</span>
    <div class="wave-buttons">
      <button class="tac-btn xs-btn" data-start-round="1">R1: STRAIGHT</button>
      <button class="tac-btn xs-btn" data-start-round="2">R2: SPIRAL</button>
      <button class="tac-btn xs-btn" data-start-round="3">R3: ACCEL</button>
      <button class="tac-btn xs-btn" data-start-round="4">R4: ZIGZAG</button>
      <button class="tac-btn xs-btn" data-start-round="5">R5: DUAL ECHO</button>
    </div>
  </div>
  <div class="round-wave-row overdrive-row">
    <span class="wave-label wave-2">WAVE 2 // OVERDRIVE:</span>
    <div class="wave-buttons">
      <button class="tac-btn xs-btn od-btn" data-start-round="6">R6: HYPER LANCE</button>
      <button class="tac-btn xs-btn od-btn" data-start-round="7">R7: TWIN CRESCENT</button>
      <button class="tac-btn xs-btn od-btn" data-start-round="8">R8: OVERDRIVE</button>
      <button class="tac-btn xs-btn od-btn" data-start-round="9">R9: DUAL VIPER</button>
      <button class="tac-btn xs-btn od-btn" data-start-round="10">R10: PHANTOM SWARM</button>
    </div>
  </div>
</div>
```

### 3.2 追加・調整CSS仕様（`style.css` 追記用）
```css
/* Left HUD Range Bonus Decay Bar */
.range-bonus-row {
  margin-top: 2px;
}

.range-decay-track {
  width: 100%;
  height: 5px;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(0, 240, 200, 0.25);
  border-radius: 3px;
  overflow: hidden;
  margin-top: 3px;
}

.range-decay-fill {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, var(--accent-emerald), var(--accent-cyan));
  transition: width 0.15s ease-out, background-color 0.2s ease;
}

.range-decay-fill.mid-range {
  background: var(--accent-gold);
}

.range-decay-fill.low-range {
  background: var(--accent-danger);
  box-shadow: 0 0 8px var(--accent-danger);
}

/* Title 2-Tier Direct Round Select (R1-R5 & R6-R10) */
.round-select-panel {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(0, 240, 200, 0.18);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.round-wave-row {
  display: grid;
  grid-template-columns: 128px 1fr;
  align-items: center;
  gap: 6px;
}

.wave-label {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  text-align: left;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.wave-label.wave-2 {
  color: #c084fc;
  text-shadow: 0 0 6px rgba(168, 85, 247, 0.45);
}

.wave-buttons {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 5px;
}

.tac-btn.xs-btn {
  padding: 4px 4px;
  font-size: 9.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tac-btn.od-btn {
  background: rgba(168, 85, 247, 0.14);
  border-color: rgba(168, 85, 247, 0.45);
  color: #f3e8ff;
}

.tac-btn.od-btn:hover {
  background: rgba(168, 85, 247, 0.32);
  border-color: #00f0ff;
  color: #ffffff;
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.4);
}

/* 10-Round All-Clear Breakdown 2-Column Grid */
.allclear-breakdown {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 10px;
  margin-bottom: 14px;
  font-family: var(--font-mono);
  font-size: 10.5px;
}
```