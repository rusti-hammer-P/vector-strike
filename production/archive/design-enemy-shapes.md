ユーザーフィードバックおよび承認内容に基づき、全5ラウンド（5種類の機動タイプ＋Round 5デコイ）の敵それぞれについて、**「①ソナー検知時のブリップ＆過去残像の固有ジオメトリ」** と **「②決着アンベール時の敵機ベクターシルエット」** のCanvas 2D描画仕様を策定しました。

---

## 0. デザイン条件の整理

- **確定条件（変更なし）**:
  - 各ラウンドの軌道数式、速度、当たり判定半径（`TARGET_RADIUS = 16px`, `R_HIT = 22px`, `CORE_HIT_DIST = 34px`）、ゲームルール、スコア計算式は一切変更しない。
  - 外部画像アセットは使用せず、すべてCanvas 2Dのパス描画（ポリゴン・アーク・ベジェ曲線・ライン）で実装する。
- **承認された変更・委任事項（本仕様で定義）**:
  - `src/engine.js` でターゲットおよび記録ブリップに進行方向角度 `heading`（$\operatorname{atan2}(v_y, v_x)$）と機動状態フラグ（Round 3の加速状態 `isBoosted`、Round 4の現在旋回方向 `turnDir` 等）を持たせる。
  - `src/renderer.js` の `drawBlipsAndVectors()` と `drawTruthUnveil()` において、単一の丸（`ctx.arc`）ではなく、各ラウンドの軌道・避け方に対応した固有のブリップ形状と敵機ベクターシルエットを描画する。

---

## 1. `src/engine.js`：進行方向ベクトル (`heading`) と機動状態メタデータの算出仕様

ブリップや敵機シルエットを進行方向・旋回方向へ正確に向けるため、`computeTargetCoords(round, targetId, t, theta0, s = 1)`（またはラッパー関数）で微小時間差 $\Delta t = 0.01\text{s}$ を用いた進行方向角 `heading` と、ラウンド固有の機動状態プロパティを算出して `target` と `blip` の両方に保持させます。

### 1.1 `computeTargetCoords` の拡張仕様
微小時間 $\Delta t = 0.01$ 秒後の座標 $(x_2, y_2)$ との差分から進行方向角度 `heading`（ローカル $+X$ 軸＝機首先端方向）を算出します。

```js
// computeTargetCoords 内の基本座標 (x, y, r, theta) 算出後、または補助関数で付与:
const dtHeading = 0.01;
// ※再帰呼び出しを避けるため内部関数 evalRawCoords(round, targetId, t, theta0, s) で (x, y, r, theta) を計算
const next = evalRawCoords(round, targetId, time + dtHeading, theta0, s);
const vx = next.x - cur.x;
const vy = next.y - cur.y;
// 速度が極小（中心到達時 r=0 など）の場合は中心向き (theta + Math.PI) にフォールバック
const heading = (vx * vx + vy * vy > 1e-8)
  ? Math.atan2(vy, vx)
  : normalizeAngle(cur.theta + Math.PI);

// ラウンド固有の機動状態メタデータ
const isBoosted = (round === 3 && (time >= 6.0 || cur.r <= 230.0));
const period = 3.6;
const phaseIndex = Math.floor(time / period);
// Round 4: 現在どちらの角速度方向へ切っているか (+1: 時計回り側 / -1: 反時計回り側)
const zigzagDir = (phaseIndex % 2 === 0 ? 1 : -1) * s;
// Round 2, 3, 5 の旋回方向符号 (+1 or -1)
const spiralSign = s;
```

### 1.2 `target` および `recordBlip()` に追加するプロパティ
- **`target` オブジェクト**:
  - `heading`: 現在の進行方向角度（rad）
  - `turnSign`: `game.turnSign`（`+1` または `-1`）
  - `isBoosted`: Round 3 で $r \le 230\text{px}$（$t \ge 6.0\text{s}$）の加速フェーズ中かどうか（`boolean`）
  - `zigzagDir`: Round 4 で現在の折れ線フェーズの旋回方向符号（`+1` または `-1`）
- **`recordBlip(game, target, source)` で生成する `blip` オブジェクト**:
  - 既存の `{ id, targetId, x, y, r, theta, detectedAt, source, isDecoyEcho }` に加え、検知瞬間の以下のスナップショットを追加：
  - `round: game.round`
  - `heading: target.heading`
  - `turnSign: target.turnSign`
  - `isBoosted: Boolean(target.isBoosted)`
  - `zigzagDir: target.zigzagDir || 1`

---

## 2. 各ラウンド固有の「①ソナーブリップ形状」＆「②アンベール敵機シルエット」Canvas 2D 描画仕様

すべての描画はローカル座標系で **`ctx.translate(x, y); ctx.rotate(heading);`** を行った状態（**右方向 `( +X, 0 )` が進行方向先端**、**左方向 `( -X, 0 )` が機体後方**、**`+Y` が進行方向右手側**、**`-Y` が進行方向左手側**）を基準として定義します。

### 共通カラー＆世代減衰ルール（ブリップ描画時）
- **最新ブリップ `B_0` (`idx === 0`)**:
  - `glowColor`: 通常 `#00FFAA` / Danger時 `#FF3355` / Round 5 デコイ通常 `#22D3EE`
  - コア塗り（`fillStyle`）: `#FFFFFF`（`shadowColor = glowColor`, `shadowBlur = 12`）
  - 外郭線（`strokeStyle`）: `glowColor`（`lineWidth = 1.8`）
  - 検知直後 `age < 0.85s` の拡大ソナー波紋リングは既存通り維持（視覚的な検知インパクトを保証）。
- **過去残像 `B_-1, B_-2, B_-3` (`idx >= 1`)**:
  - スケール倍率 `scale`: `idx === 1 ? 0.82 : idx === 2 ? 0.68 : 0.55`
  - カラー `color`: 通常 `rgba(0, 255, 170, alpha)` / Danger時 `rgba(255, 95, 115, alpha)`
  - **重要**: 過去残像も単なる丸ではなく、**その検知時点の `b.heading` と形状（特にRound 3の加速前後やRound 4の切り返し向き）を保ったまま縮小・ワイヤーフレーム描画**する。これにより残像の並びを見るだけで「どこで向きが変わったか」「どこから加速したか」が一目瞭然になる。

---

### Round 1：`STRAIGHT APPROACH`（直線突撃型）
- **コンセプト**: **「デルタ・ランス（槍型インターセプター）」**
  - まっすぐ突っ込んでくる特性を、鋭角の二等辺三角形（槍の穂先）で表現。プレイヤーは「穂先が向いている直線の延長線上」をそのまま狙えばよいことが直感できる。

#### ① ソナーブリップ形状（`drawBlipShape` - Round 1）
`ctx.translate(b.x, b.y); ctx.rotate(b.heading);` 後：
1. **外郭デルタ・シェブロン（stroke）**:
   - スケール `s = idx === 0 ? 1.0 : (idx === 1 ? 0.82 : idx === 2 ? 0.68 : 0.55)`
   - 頂点定義（槍型の矢印ポリゴン）:
     - 先端ノーズ: `(11 * s, 0)`
     - 左後翼端: `(-7 * s, -6.5 * s)`
     - 後部ノッチ（くびれ）: `(-3.5 * s, 0)`
     - 右後翼端: `(-7 * s, 6.5 * s)`
   - `closePath()` して `strokeStyle = (idx === 0 ? glowColor : color)` で描画。
2. **中心コア（`idx === 0` のみ白発光塗り、`idx >= 1` は薄塗り）**:
   - 内側小型デルタ: `(6.5 * s, 0)` → `(-4 * s, -3.5 * s)` → `(-2 * s, 0)` → `(-4 * s, 3.5 * s)` を `fill()`。

#### ② アンベール時の敵機シルエット（`drawEnemySilhouette` - Round 1）
`ctx.translate(tgt.x, tgt.y); ctx.rotate(tgt.heading);` 後（当たり判定半径 `16px` に収まる鋭い槍型迎撃機）：
1. **メイン機体シルエット（fill + stroke）**:
   - `fillStyle = 'rgba(255, 51, 102, 0.28)'`, `strokeStyle = '#FF3366'`, `lineWidth = 2.0`
   - 頂点パス:
     - ノーズ先端: `(18, 0)`
     - 左ストレーキ段差: `(4, -4)`
     - 左デルタ主翼端: `(-12, -13)`
     - 左テール外角: `(-15, -7)`
     - 左ノズル横: `(-11, -3)`
     - センターノズル先端: `(-16, 0)`
     - 右ノズル横: `(-11, 3)`
     - 右テール外角: `(-15, 7)`
     - 右デルタ主翼端: `(-12, 13)`
     - 右ストレーキ段差: `(4, 4)`
   - `closePath()` → `fill()` & `stroke()`。
2. **内部キャノピー＆スパイン（白／ピンク発光ライン）**:
   - 機体中心軸のランス・スパイン: `moveTo(-10, 0)` → `lineTo(14, 0)`（`strokeStyle = '#FFFFFF'`, `lineWidth = 1.5`）
   - コックピット菱形: `(6, 0)` → `(0, -2.5)` → `(-5, 0)` → `(0, 2.5)`（`fillStyle = '#FFFFFF'`）

---

### Round 2：`ORBITAL SPIRAL`（等角速度スパイラル型）
- **コンセプト**: **「クレセント・ウィング（三日月・前進翼ソーサー）」**
  - 一定の曲率で弧を描きながら回り込む特性を、**旋回方向へ湾曲した三日月（クレセント）＋旋回インジケータ弧**で表現。「直線ではなくカーブの先を狙うべき敵」であることが形から伝わる。

#### ① ソナーブリップ形状（`drawBlipShape` - Round 2）
`ctx.translate(b.x, b.y); ctx.rotate(b.heading);` 後（`turn = b.turnSign || 1`）：
1. **三日月クレセント本体（fill + stroke）**:
   - スケール `s = idx === 0 ? 1.0 : (idx === 1 ? 0.82 : idx === 2 ? 0.68 : 0.55)`
   - 進行方向 `( +X )` に向かって張り出す三日月型を2本の二次ベジェ曲線（`quadraticCurveTo`）で描画：
     - `ctx.beginPath();`
     - `ctx.moveTo(-4 * s, -8.5 * s);`（左翼端）
     - `ctx.quadraticCurveTo(10 * s, 0, -4 * s, 8.5 * s);`（前縁の丸い弧）
     - `ctx.quadraticCurveTo(2.5 * s, 0, -4 * s, -8.5 * s);`（後縁のえぐれ弧）
     - `ctx.closePath();`
   - `idx === 0` のときは内側を `#FFFFFF`（または淡いシアン）で `fill()` し、`glowColor` で `stroke()`。
2. **スパイラル旋回方向ウィングチップ・アーク（`idx === 0` および `idx === 1`）**:
   - 旋回内側（`turn > 0` なら `+Y` 側、`turn < 0` なら `-Y` 側）へ曲がる軌道を示すため、先端から旋回方向へ曲がる短いガイド弧を追加：
     - `ctx.beginPath();`
     - `ctx.moveTo(4 * s, 0);`
     - `ctx.quadraticCurveTo(9 * s, turn * 4 * s, 5 * s, turn * 9 * s);`
     - `ctx.stroke();`

#### ② アンベール時の敵機シルエット（`drawEnemySilhouette` - Round 2）
`ctx.translate(tgt.x, tgt.y); ctx.rotate(tgt.heading);` 後：
1. **前進翼クレセント・ソーサー外郭（fill + stroke）**:
   - `fillStyle = 'rgba(255, 51, 102, 0.26)'`, `strokeStyle = '#FF3366'`, `lineWidth = 2.0`
   - パス定義:
     - `ctx.beginPath();`
     - 左前進翼先端: `ctx.moveTo(6, -15);`
     - 前縁ラウンドノーズ: `ctx.quadraticCurveTo(17, 0, 6, 15);`
     - 右翼内縁: `ctx.lineTo(-2, 11);`
     - 後部エンジンベイ弧: `ctx.quadraticCurveTo(5, 0, -2, -11);`
     - `ctx.closePath(); ctx.fill(); ctx.stroke();`
2. **中央ジャイロ・ローターリング＆コア**:
   - 中心 `(2, 0)` に半径 `6.5px` の円形ローターリング（`strokeStyle = '#FF8099'`, `lineWidth = 1.4`）。
   - ローター内の3枚ブレード線（`game.roundTime * 6 * tgt.turnSign` で回転角を付けた3方向スポーク、半径 `6px`）。
   - 中心コア点 `(2, 0)` に半径 `2.5px` の `#FFFFFF` サークル。

---

### Round 3：`PHANTOM ACCEL`（2段階急加速型）
- **コンセプト**: **「ツイン・スラスター（可変翼ニードル＆アフターバーナー機）」**
  - **通常フェーズ（$r > 230\text{px}$、`!b.isBoosted`）**: スリムに閉じた細長いニードル菱形（巡航形態）。
  - **急加速フェーズ（$r \le 230\text{px}$、`b.isBoosted === true`）**: 可変翼が展開し、**機体後方に3本のアフターバーナー・ジェットスパイク（噴射炎エコー）が長く伸びる＋アンバーゴールド（`#FFD166`）のブースト発光が加わる**！
  - これにより、$r \le 230\text{m}$ に突入した瞬間のブリップを見ただけで「形が変わってジェット噴射が出ている＝急加速した！」と視覚的に100%察知できる。

#### ① ソナーブリップ形状（`drawBlipShape` - Round 3）
`ctx.translate(b.x, b.y); ctx.rotate(b.heading);` 後：
- スケール `s = idx === 0 ? 1.0 : (idx === 1 ? 0.82 : idx === 2 ? 0.68 : 0.55)`
- **A. 通常巡航フェーズ（`!b.isBoosted`）**:
  - 細長いスリム・ニードル菱形:
    - `(10 * s, 0)` → `(0, -4.2 * s)` → `(-9 * s, 0)` → `(0, 4.2 * s)` → `closePath()`
  - `idx === 0` は内部小型ニードル `(6, 0), (0, -2), (-5, 0), (0, 2)` を `#FFFFFF` 塗り、外枠を `glowColor` で `stroke()`。
- **B. 急加速ブーストフェーズ（`b.isBoosted === true`）**:
  1. **可変翼展開ダート本体**:
     - 先端がさらに鋭く伸び、左右に小翼が張り出す:
     - `(13 * s, 0)` → `(1 * s, -3.5 * s)` → `(-5 * s, -7.5 * s)` → `(-4 * s, -2.5 * s)` → `(-8 * s, 0)` → `(-4 * s, 2.5 * s)` → `(-5 * s, 7.5 * s)` → `(1 * s, 3.5 * s)` → `closePath()`
  2. **後方アフターバーナー・3連ジェットスパイク（ブーストの視覚記号）**:
     - `strokeStyle = idx === 0 ? '#FFD166' : color`（最新ブリップでは鮮やかなアンバーゴールド `#FFD166` で噴射炎を強調）
     - 中央メイン噴射スパイク: `moveTo(-8 * s, 0)` → `lineTo(-18 * s, 0)`（`lineWidth = 2.2 * s`）
     - 左右サブ噴射スパイク:
       - `moveTo(-6 * s, -3.5 * s)` → `lineTo(-14 * s, -5.5 * s)`
       - `moveTo(-6 * s, 3.5 * s)` → `lineTo(-14 * s, 5.5 * s)`
     - さらに後方にV字ショックコーン（衝撃波シェブロン）:
       - `moveTo(-11 * s, -5 * s)` → `lineTo(-15 * s, 0)` → `lineTo(-11 * s, 5 * s)`

#### ② アンベール時の敵機シルエット（`drawEnemySilhouette` - Round 3）
`ctx.translate(tgt.x, tgt.y); ctx.rotate(tgt.heading);` 後：
1. **双発可変翼ブースター機シルエット（fill + stroke）**:
   - 長大な高速ニードルノーズ＋双発エンジンポッド形状:
   - 頂点パス:
     - ノーズ先端: `(20, 0)`
     - 左カナード基部: `(5, -3)` → 左前進カナード: `(7, -7)` → `(2, -4)`
     - 左主翼端: `(-8, -13)` → 左主翼後縁: `(-13, -10)`
     - 左エンジンノズル: `(-16, -5)` → `(-12, -2)`
     - 中央テールコーン: `(-14, 0)`
     - 右エンジンノズル: `(-12, 2)` → `(-16, 5)`
     - 右主翼後縁: `(-13, 10)` → 右主翼端: `(-8, 13)`
     - 右カナード: `(2, 4)` → `(7, 7)` → `(5, 3)`
   - `closePath()` → `fill()` & `stroke()`。
2. **ツイン・アフターバーナー噴射プルーム（`tgt.isBoosted` 時は特大描画）**:
   - 左ノズル `(-16, -4)`・右ノズル `(-16, 4)` から後方 `(-28, -4)`, `(-28, 4)` へ伸びる2本の鋭い三角形プラズマフレーム（`fillStyle = 'rgba(255, 209, 102, 0.75)'`, コア `#FFFFFF`）。

---

### Round 4：`ZIGZAG VECTOR`（3.6秒周期反転ジグザグ型）
- **コンセプト**: **「サイドワインダー（双頭シェブロン／Xウィング・スラローマー）」**
  - 3.6秒ごとに旋回方向がカクッと切り返されるトリッキーな機動を、**鋭角に折れ曲がったW字／Xウィング形状＋現在切っている旋回方向側へのバンク（傾斜フラップ発光）**で表現。
  - ブリップの左右どちらのベクターフラップが伸びているかを見ることで、「今こっちの斜め方向へジグザグ進行している」ことと「切り返し前後で向きが反転した」ことが視覚的に読み取れる。

#### ① ソナーブリップ形状（`drawBlipShape` - Round 4）
`ctx.translate(b.x, b.y); ctx.rotate(b.heading);` 後（`zDir = b.zigzagDir || 1`）：
- スケール `s = idx === 0 ? 1.0 : (idx === 1 ? 0.82 : idx === 2 ? 0.68 : 0.55)`
1. **ジグザグ・ツインシェブロン（二重折れ線矢印）**:
   - 前段シェブロン（先端）:
     - `moveTo(-1 * s, -7.5 * s)` → `lineTo(9.5 * s, 0)` → `lineTo(-1 * s, 7.5 * s)`
   - 後段シェブロン（折れ線エコー）:
     - `moveTo(-7 * s, -6.5 * s)` → `lineTo(3 * s, 0)` → `lineTo(-7 * s, 6.5 * s)`
   - 中心菱形コア:
     - `(7 * s, 0)` → `(1 * s, -3.5 * s)` → `(-4 * s, 0)` → `(1 * s, 3.5 * s)` を `fill()`。
2. **現在旋回方向（`zDir`）を示すアクティブ・スラロームフラップ**:
   - 現在曲がっている側（`ySide = zDir > 0 ? 1 : -1`）の翼端に、切り返し方向を示す鋭いサイドフィン（カナード棘）を描画：
     - `ctx.beginPath();`
     - `ctx.moveTo(4 * s, ySide * 3.5 * s);`
     - `ctx.lineTo(2 * s, ySide * 10.5 * s);`
     - `ctx.lineTo(-4 * s, ySide * 5.5 * s);`
     - `ctx.strokeStyle = idx === 0 ? '#FFD166' : color;`
     - `ctx.lineWidth = 1.8 * s;`
     - `ctx.stroke();`

#### ② アンベール時の敵機シルエット（`drawEnemySilhouette` - Round 4）
`ctx.translate(tgt.x, tgt.y); ctx.rotate(tgt.heading);` 後：
1. **Xウィング・ベクタースラローマー外郭（fill + stroke）**:
   - 前後4枚の鋭角カナード＆主翼がX字状に交差する高機動ドローン形状：
   - 頂点パス:
     - ノーズ先端: `(15, 0)`
     - 左前カナード先端: `(10, -12)` → 左前カナード根元: `(1, -5)`
     - 左後主翼先端: `(-11, -14)` → 左後主翼内縁: `(-9, -4)`
     - テールノッチ: `(-15, 0)`
     - 右後主翼内縁: `(-9, 4)` → 右後主翼先端: `(-11, 14)`
     - 右前カナード根元: `(1, 5)` → 右前カナード先端: `(10, 12)`
   - `closePath()` → `fill()` & `stroke()`。
2. **ジグザグ・スラスターライン（内部X字フレーム）**:
   - `moveTo(8, -9)` → `lineTo(-8, 9)` および `moveTo(8, 9)` → `lineTo(-8, -9)`（`strokeStyle = '#FFFFFF'`, `lineWidth = 1.2`）。

---

### Round 5：`DUAL ECHO`（ステルスボス `main` ＆ 電子デコイ `decoy`）
Round 5ではプレイヤーが「軌道の間隔・揺らぎ」と「形状のわずかな違い（または戦術パルス看破）」から本物と偽物を見破るクライマックスです。

#### Round 5 本物 (`targetId === 'main'`)：**「ヘビー・ステルス・ドレッドノート（多重装甲ステルス機）」**
- **① ソナーブリップ形状（Round 5 `main`）**:
  - **重厚なステルス・ダイヤモンド＋フロントツインファセット（二重装甲枠）**:
    - 外郭ステルス・ポリゴン:
      - ノーズ `(10.5 * s, 0)` → 左前肩 `(3 * s, -7.5 * s)` → 左後翼端 `(-7.5 * s, -5.5 * s)` → 後部ノッチ `(-4.5 * s, 0)` → 右後翼端 `(-7.5 * s, 5.5 * s)` → 右前肩 `(3 * s, 7.5 * s)` → `closePath()`
    - 内側コア・ヘキサゴン（六角コア）を `#FFFFFF`（`idx === 0`）で塗り、外枠を `glowColor` で `stroke()`。
- **② アンベール時の敵機シルエット（Round 5 `main`）**:
  - **全翼機（B-2 / ステルス戦闘爆撃機風）＋多重六角リアクターコア**:
    - 頂点パス（ノコギリ状のステルス後縁を持つ威圧的なシルエット）:
      - ノーズ先端: `(16, 0)`
      - 左前縁: `(2, -16)` → 左外翼端: `(-6, -16)`
      - 左後縁ジグザグ（ステルス・セレーション）: `(-3, -10)` → `(-11, -8)` → `(-7, -3)` → `(-14, 0)`
      - 右後縁ジグザグ: `(-7, 3)` → `(-11, 8)` → `(-3, 10)`
      - 右外翼端: `(-6, 16)` → 右前縁: `(2, 16)`
      - `closePath()` → `fill()` & `stroke()`。
    - 中央に半径 `5.5px` の六角形リアクターコア（`strokeStyle = '#FFFFFF'`, `lineWidth = 1.5`）と中心点。

#### Round 5 偽物 (`targetId === 'decoy'`)：**「ホログラム・プリズム（分裂グリッチ・ドローン）」**
- **① ソナーブリップ形状（Round 5 `decoy`）**:
  - **通常スイープ検知時（`!b.isDecoyEcho`）**:
    - 本物の重厚なソリッドコアとは対照的に、**「中抜き（ホロウ）の分裂プリズム菱形＋微細な位相ズレ（グリッチ・スプリット）」** で描画する。
    - 進行方向前後の2つのV字ブラケットがわずかに隙間を空けて浮いている形状：
      - 前方Vブラケット: `moveTo(0, -6.5 * s)` → `lineTo(8.5 * s, 0)` → `lineTo(0, 6.5 * s)`
      - 後方Vブラケット: `moveTo(-1 * s, -5.5 * s)` → `lineTo(-8.5 * s, 0)` → `lineTo(-1 * s, 5.5 * s)`
      - 中心は塗りつぶさず、小さな中空リングまたは2本の水平グリッチ走査線（`jx = Math.sin(game.roundTime * 35) * 1.2`）を描画。
  - **戦術パルス看破時（`b.isDecoyEcho === true`）**:
    - 赤紫（`#FB7185` / `#F43F5E`）で激しくジッター振動する分裂ダイヤに加え、**機体の上を貫くX字のグリッチ・クラック（バツ印のノイズ線）** と既存の `'FAKE / DECOY'` タグを描画。
- **② アンベール時の敵機シルエット（Round 5 `decoy`）**:
  - `strokeStyle = '#94A3B8'`, `fillStyle = 'rgba(148, 163, 184, 0.14)'`
  - **4分割に浮遊したホログラム・プロジェクター（十字隙間のある4つの小ダイヤ翼＋外周破線リング）**:
    - 前 `(10, 0)`・後 `(-10, 0)`・左 `(0, -10)`・右 `(0, 10)` に4つの独立した小型菱形ブレードを配置し、中心 `(0, 0)` から4方向へ点線のホログラム投影ビームを引く。
    - これによりアンベール時にも「こちらは実体のないホログラム投影デコイだった」ことが一目で納得できる。

---

## 3. `src/renderer.js` への実装メソッド構成案

Programmerが `src/renderer.js` にそのまま組み込めるよう、`RadarRenderer` クラスに追加する2つのヘルパーメソッドのインターフェースを定義します。

### 3.1 `drawBlipShape(ctx, game, blip, idx, alpha, isDanger, isUnveil)`
- `drawBlipsAndVectors` 内の各ブリップ描画ループから呼び出す。
- 引数:
  - `blip`: `{ x, y, r, theta, heading, round, targetId, isBoosted, zigzagDir, turnSign, isDecoyEcho, ... }`
  - `idx`: `0`（最新 `B_0`）〜 `3`（最古 `B_-3`）
  - `alpha`: 時間減衰×世代重み後の不透明度
- 処理フロー:
  1. `idx === 0` かつ `age < 0.85` かつ `!isUnveil` の場合、座標 `(blip.x, blip.y)` に既存のソナー波紋リングを描画。
  2. `blip.isDecoyEcho` の場合、既存のグリッチ振動＋分裂プリズム＋X字クラック＋`'FAKE / DECOY'` ラベルを描画。
  3. それ以外の場合、`ctx.save(); ctx.translate(blip.x, blip.y); ctx.rotate(blip.heading ?? (blip.theta + Math.PI));` を実行し、`blip.targetId === 'decoy'` なら Round 5 デコイ形状、それ以外は `blip.round || game.round`（`1`〜`5`）に応じた上記セクション2の「① ソナーブリップ形状」を描画して `ctx.restore()`。
  4. `idx === 0` の距離・経過秒数ラベル（`${Math.round(b.r)}m (+${age.toFixed(1)}s)`）および `idx >= 1` の世代番号ラベル（`-${idx}`）は回転の影響を受けないよう `ctx.restore()` 後の水平座標系で `(b.x + 12, b.y - 6)` にそのまま描画する（可読性維持）。

### 3.2 `drawEnemySilhouette(ctx, game, tgt)`
- `drawTruthUnveil` 内のターゲット描画ループ（`for (const tgt of game.targets)`）から呼び出す。
- 処理フロー:
  1. **当たり判定の明示（ゲームプレイの公平性・納得感のため維持）**:
     - 外側の有効命中半径リング（`CONSTANTS.R_HIT = 22px`、破線円）は既存通り描画。
     - 物理当たり判定円（`CONSTANTS.TARGET_RADIUS = 16px`）は、シルエットを引き立てるために細い半透明リング（`lineWidth = 1.0`, `rgba(255, 51, 102, 0.35)`）として背景に残す。
  2. **固有ベクターシルエットの描画**:
     - `ctx.save(); ctx.translate(tgt.x, tgt.y); ctx.rotate(tgt.heading ?? (tgt.theta + Math.PI));`
     - `tgt.id === 'decoy'` ならホログラム・プリズム形状、`tgt.id === 'main'` なら `game.round`（`1`〜`5`）に応じた上記セクション2の「② アンベール時の敵機シルエット」を描画。
     - `ctx.restore();`
  3. **ラベル描画**:
     - 回転解除後に `'TRUE TARGET'` / `'HIT TARGET'` / `'DECOY'` ラベルを `(tgt.x + 22, tgt.y - 12)` に水平描画する。

---

## 4. 既存機能・テストとの互換性確認

- **当たり判定への影響**: ゼロ。当たり判定は `src/engine.js` の `CONSTANTS.R_HIT (22.0)` および `CONSTANTS.CORE_HIT_DIST (34.0)` の数学的線分・中心距離判定のままであり、描画形状の変更によってゲームの勝敗判定や既存テストが壊れることはありません。
- **可読性・視認性**:
  - 距離・秒数ラベルや世代番号 `-1, -2, -3`、アンベール時の誤差表示 `MISS BY XX px` はすべて水平テキストのまま維持されます。
  - 各ブリップとシルエットが進行方向 `heading` を向くことで、初見プレイヤーでも「敵が今どちらへ進んでいるか」「どんな機動特性の敵か」が直感的に把握でき、偏差射撃の楽しさと納得感が大幅に向上します。