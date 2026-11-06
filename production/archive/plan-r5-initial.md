# 『blind-radar-shot』企画仕様書（Game Plan & Specification）

## ステータス
- **対象プロジェクト**: `projects/blind-radar-shot`
- **参照資料**:
  - `projects/blind-radar-shot/production/requirements.md`（承認済み）
  - `projects/blind-radar-shot/production/direction.md`（制作方針）
- **作成役**: Game Planner

---

## 0. 条件整理（明示済み条件・委任決定事項・前提・未解決事項）

### 0.1 明示済み条件（変更不可）
- **ジャンル・コア体験**: 全方位2Dシューティング（2DSTG）プロトタイプ。通常時は敵が不可視であり、ソナー／スイープが通過した瞬間の反応点（ブリップ）と残像から敵の軌道を読み、**たった1発の徹甲弾**で仕留める。
- **対象環境**: PCブラウザ（HTML / CSS / JavaScript、外部ビルド不要・外部アセット非依存）。
- **勝敗ルール**: 完全1発勝負。各ラウンドで発射できる弾は1発のみ。命中すれば撃破（CLEAR）、外れて弾が消失するか自機が被弾すると敗北（FAIL）。

### 0.2 委任項目の決定事項
- **自機配置と操作系**: レーダー中心 `(0, 0)` の固定タレット。マウス360度照準＋キーボード微調整併用。左クリック／`Space` で1発射撃、右クリック／`Shift`／`E` で1ラウンド1回限定の「戦術パルス（Tactical Ping）」発動。
- **ラウンド構成**: 軌道アルゴリズムが段階的に変化する全5ラウンド制（直線斜行 → 対数・等速スパイラル → 2段階加減速 → 折れ線ジグザグ → デコイ伴走ボス）。
- **答え合わせ（Unveil）機能**: 勝敗確定時に暗闇を解除し、敵の全移動軌跡・現在位置・自機弾の通過軌跡・最短すれ違い距離（`minMissDistance`）を画面上に明示する。

### 0.3 前提条件
- 内部演算はフレームレート非依存の経過時間 `dt`（秒単位、上限クランプ `Math.min(dt, 0.05)`）で更新する。
- 角度計算は標準極座標系（右＝東を $0\text{ rad}$、時計回りを正、範囲 $[0, 2\pi)$）を基準とする（画面表示上のN/E/S/W方位表記はDesignerのUI設計で0度＝北と表示してよいが、内部物理・テストAPIは右＝$0\text{ rad}$、時計回り正で統一する）。

### 0.4 未解決事項（Producerへの差し戻し事項）
- **なし**（すべての仕様は承認済み要件および制作方針の範囲内で自己完結している）。

---

## 1. レーダー座標系と空間パラメータ

### 1.1 キャンバスとレーダー論理座標系
- **基準キャンバス解像度**: `960 × 720 px`（アスペクト比 4:3、またはウィンドウリサイズ時に中央へ等倍〜アスペクト比維持スケーリング）
- **レーダー原点 `(0, 0)`**: キャンバス中央 `(480, 360)` を論理座標 `(x: 0, y: 0)` とする。
- **画面座標 `(sx, sy)` と論理座標 `(x, y)` の変換**:
  $$x = sx - 480, \quad y = sy - 360$$
  $$r = \sqrt{x^2 + y^2}, \quad \theta = \operatorname{atan2}(y, x) \pmod{2\pi}$$

### 1.2 主要リング半径と当たり判定定義
| 名称 | パラメータ名 | 数値 (px) | 役割・仕様 |
| :--- | :--- | :--- | :--- |
| **レーダー外周半径** | `RADAR_RADIUS` | `360 px` | ソナー探知圏の外縁。敵はこの外周付近（`330〜350 px`）に出現し、自機弾はこの外周を超えた瞬間に「外れ（MISS）」が確定する。 |
| **距離目盛りリング** | `RANGE_RINGS` | `90, 180, 270, 360 px` | `90 px` 刻みの4本の同心円（100m / 200m / 300m / 400m 相当の距離定規として機能）。 |
| **危険領域リング** | `DANGER_RADIUS` | `120 px` | 敵の中心座標が $r \le 120\text{ px}$ に入ると接近警報（アンバー／レッド演出＋高ピッチPing音）が発動する境界。 |
| **自機コア半径** | `CORE_RADIUS` | `18 px` | 原点 `(0, 0)` に位置する自機タレットの被弾判定半径。 |
| **敵ターゲット半径** | `TARGET_RADIUS` | `16 px` | 敵本体の当たり判定半径（全ラウンド共通）。 |
| **自機被弾（敗北）距離** | `CORE_HIT_DIST` | `34 px` | `CORE_RADIUS (18) + TARGET_RADIUS (16)`。敵（本物）の中心距離 $r(t) \le 34\text{ px}$ となった瞬間に自機被弾（`RESULT_FAIL: CORE_BREACHED`）となる。 |

---

## 2. ソナー・スイープとブリップ残像仕様

### 2.1 スイープ回転仕様
- **初期角度**: ラウンド開始時 $\theta_{\text{sweep}}(0) = -\frac{\pi}{2} \pmod{2\pi} = \frac{3\pi}{2}\text{ rad}$（画面真上＝12時方向）。
- **回転方向・角速度**: 時計回り（正方向）、角速度 $\omega_{\text{sweep}} = \pi\text{ rad/s}$（$180^\circ\text{/s}$、**1周 2.00秒**）。
- **更新式**:
  $$\theta_{\text{prev}} = \theta_{\text{sweep}}(t), \quad \theta_{\text{curr}} = (\theta_{\text{sweep}}(t) + \omega_{\text{sweep}} \cdot dt) \pmod{2\pi}$$

### 2.2 角度跨ぎ対応のスイープ交差判定ロジック
フレーム間のスキップ（検知漏れ）を防ぐため、前フレーム角度 $\theta_{\text{prev}}$ から現フレーム角度 $\theta_{\text{curr}}$ までの回転扇形区間に敵の現在角度 $\theta_{\text{enemy}}$（範囲 $[0, 2\pi)$）が含まれるかを以下の関数で厳密に判定する。

```js
function isAngleSwept(thetaPrev, thetaCurr, targetAngle) {
  const TWO_PI = Math.PI * 2;
  const norm = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
  const p = norm(thetaPrev);
  const c = norm(thetaCurr);
  const t = norm(targetAngle);

  if (p <= c) {
    return t >= p && t <= c;
  } else {
    // 2π → 0 の角度跨ぎ発生時
    return t >= p || t <= c;
  }
}
```
- **連続多重検知の防止（クールダウン）**: 敵自身の角速度がスイープと同方向に動く場合などの二重検知を防ぐため、各ターゲットにつき一度スイープ検知された後は `SWEEP_DETECT_COOLDOWN = 0.40 秒` が経過するまで次の回転スイープ検知を発生させない（ただし「戦術パルス」による強制検知はこのクールダウンを無視して即座に記録される）。

### 2.3 ブリップ（反応点）残像履歴仕様
スイープまたは戦術パルスがターゲット（本物・デコイそれぞれ）を検知した瞬間、その時点の座標スナップショットを `blipHistory` 配列の先頭に追加する。
- **ブリップデータ構造**:
  ```ts
  interface Blip {
    id: number;          // 通し番号
    targetId: string;    // 'main' | 'decoy'
    x: number;           // 検知時の論理X座標 (px)
    y: number;           // 検知時の論理Y座標 (px)
    r: number;           // 検知時の中心距離 (px)
    theta: number;       // 検知時の角度 (rad)
    detectedAt: number;  // ラウンド経過時刻 (s)
    source: 'sweep' | 'pulse'; // スイープ検知か戦術パルス検知か
    isDecoyEcho: boolean;// 戦術パルスで暴かれたデコイ識別フラグ
  }
  ```
- **最大保持数**: 各ターゲット系統につき最新 **4件**（最新点 $B_0$ ＋ 過去残像 $B_{-1}, B_{-2}, B_{-3}$）。5件目が入った時点で最古のブリップを破棄する。
- **減衰秒数（フェードアウト寿命）**: `BLIP_LIFETIME = 6.0 秒`（スイープ3周分）。
  - 経過時間 $\Delta t = t_{\text{now}} - \text{detectedAt}$ に応じ、不透明度 $\alpha = \max(0, 1 - \Delta t / 6.0)$ で減衰表示する。
  - 最新3点（$B_0, B_{-1}, B_{-2}$）の間には、移動ベクトルを視覚的に補助する薄い破線（ガイドライン）を描画する。

---

## 3. 戦術パルス（Tactical Ping）仕様

回転スイープを待つだけの受動性を打破し、敵の変針直後やデコイの正体を見破るための切り札。

- **発動入力**: 右クリック、`Shift` キー、または `E` キー（`PLAYING` 状態のみ有効）。
- **使用回数制限**: **1ラウンドにつき 1回のみ**（`tacticalPingRemaining = 1` → 発動後 `0`）。
- **探知方式**: 原点 `(0, 0)` から外周 `360 px` まで広がる**高速全方位リングパルス**。
  - **パルス拡散速度**: `PULSE_SPEED = 1440 px/s`（中心から外周まで **0.25秒** で到達）。
  - **検知判定**: パルス半径 $R_{\text{pulse}}(t)$ が前フレーム $R_{\text{prev}}$ から現フレーム $R_{\text{curr}}$ へ拡大する際、$R_{\text{prev}} \le r_{\text{enemy}} \le R_{\text{curr}}$ を満たした瞬間にその敵の位置をブリップとして即座に記録・発光させる。
- **戦術パルスの特殊効果（Round 5 デコイ識別）**:
  - 通常の回転スイープ（パッシブ／低出力）では本物とデコイは同じブリップ波形に見えるが、高出力の**戦術パルスがデコイを通過した瞬間、デコイのブリップは「グリッチ波形（中抜きひし形・ノイズ色・専用不協和Ping音）」として記録され、偽物であることが確定的に暴かれる**。
- **不使用ボーナス（No-Ping Bonus）**:
  - 戦術パルスを1回も使わずにラウンドをクリアした場合、スコアに `+1,500 pts`（NO-PING BONUS）が加算される。

---

## 4. 自機の照準と1発必殺弾（One-Shot Railgun）仕様

### 4.1 照準操作（マウス＋キーボード微調整）
- **マウス操作**: マウスカーソル移動で照準角度 $\phi_{\text{aim}} = \operatorname{atan2}(y_{\text{mouse}}, x_{\text{mouse}})$ と照準距離 $d_{\text{aim}} = \min(360, \sqrt{x_{\text{mouse}}^2 + y_{\text{mouse}}^2})$ を即時更新する。
- **キーボード微調整**:
  - `←` / `A` キー：照準角度を反時計回りに回転
  - `→` / `D` キー：照準角度を時計回りに回転
  - 通常回転速度：`1.2 rad/s`（約 $68.8^\circ\text{/s}$）、微調整モード（`Ctrl` キー押下中または照準距離維持）：`0.35 rad/s`（約 $20^\circ\text{/s}$）。
- **照準レティクルの戦術情報表示**:
  - レティクル位置に現在の照準距離 $d_{\text{aim}}\text{ (px)}$ と、原点からその距離までの**予測着弾時間 $t_{\text{ETA}} = d_{\text{aim}} / V_{\text{bullet}}\text{ (秒)}$**（例：`240m / ETA 0.24s`）を常時リアルタイム表示する。

### 4.2 1発必殺弾（徹甲弾）の物理パラメータ
- **発射入力**: 左クリック、`Space` キー、または `Enter` キー（`PLAYING` 状態かつ `ammo === 1` の時のみ発射可能）。
- **装弾数**: **1ラウンドにつき 1発（`ammo = 1`）**。発射と同時に `ammo = 0` となり、状態は `SHOT_FLYING` へ遷移する。
- **弾速**: `BULLET_SPEED = 1000 px/s`（中心 `0 px` から外周 `360 px` まで **0.36秒**）。
- **弾の当たり判定半径**: `BULLET_RADIUS = 6 px`
- **最大射程**: `BULLET_MAX_RANGE = 360 px`（レーダー外周と同一）。
- **弾の移動更新式**（発射角 $\phi_{\text{fire}}$、発射からの経過時間 $\tau$）：
  $$r_{\text{bullet}}(\tau) = V_{\text{bullet}} \cdot \tau = 1000 \cdot \tau$$
  $$x_{\text{bullet}}(\tau) = r_{\text{bullet}}(\tau) \cos \phi_{\text{fire}}, \quad y_{\text{bullet}}(\tau) = r_{\text{bullet}}(\tau) \sin \phi_{\text{fire}}$$

### 4.3 命中判定（連続衝突判定：トンネリング防止）
弾速が `1000 px/s` と高速であるため（60fpsで1フレームあたり約 `16.7 px` 移動）、フレーム間のすり抜けを防ぐため、毎フレーム**弾の移動線分 $P_{\text{bullet}}(t_{\text{prev}}) \to P_{\text{bullet}}(t_{\text{curr}})$ と敵中心座標 $P_{\text{enemy}}(t_{\text{curr}})$ の最短距離 $d_{\text{seg}}$** を算出して判定する。
- **有効命中半径（Combined Hit Radius）**:
  $$R_{\text{hit}} = \text{BULLET\_RADIUS} (6) + \text{TARGET\_RADIUS} (16) = 22.0\text{ px}$$
- **命中条件**:
  - 本物の敵（`targetId === 'main'`）に対し $d_{\text{seg}} \le 22.0\text{ px}$ となった瞬間、**命中（HIT）** が確定し、即座に `RESULT_CLEAR` へ遷移する。
  - その際、敵の中心から弾道までの最短距離 $d_{\text{seg}}$ を `hitOffsetPx`（命中精度ズレ距離、`0.0〜22.0 px`）として記録する。
- **デコイ命中時の挙動（Round 5）**:
  - 弾がデコイ（`targetId === 'decoy'`）に接触（$d_{\text{seg}} \le 22.0\text{ px}$）した場合、デコイはホログラムノイズを発して消滅するが、**徹甲弾は減衰せずそのまま直進を継続する**（もし同一直線上の奥に本物がいた場合は貫通命中しうるが、外周まで本物に当たらなければ `RESULT_FAIL: DECOY_BAITED` となる）。
- **外れ確定条件（Miss Condition）**:
  - 本物に命中しないまま $r_{\text{bullet}}(\tau) \ge 360\text{ px}$（`RADAR_RADIUS` 到達）となった瞬間、**外れ（MISS）** が確定し、即座に `RESULT_FAIL`（理由：`SHOT_MISSED`、デコイを撃っていた場合は `DECOY_BAITED`）へ遷移する。

---

## 5. 全5ラウンドの敵挙動アルゴリズムと数値パラメータ

すべてのラウンドにおいて、ラウンド開始時の敵初期方位角 $\theta_0 \in [0, 2\pi)$ はランダム（または自動テスト時は指定シード／固定値 $\theta_0 = 0.25\pi$）で決定される。また、進行方向の左右反転符号 $s \in \{+1, -1\}$ もランダム（テスト時は $s = +1$ 固定可）とする。

### Round 1: `STRAIGHT APPROACH`（等速直線・オフセット進入）
- **コンセプト**: 点と点を直線で結ぶ基本の偏差射撃を学ぶ。直進軌道だが中心 `(0, 0)` からオフセットした弦（斜め直線）を通って危険域へ進入するため、光った場所をそのまま撃つと外れる。
- **初期配置**: 距離 $r_0 = 340\text{ px}$、初期方位角 $\theta_0$。
  $$P_{\text{start}} = (340 \cos \theta_0, \; 340 \sin \theta_0)$$
- **移動アルゴリズム**:
  - **フェーズ1（外周→内周オフセット直進）**: 原点から距離 $75\text{ px}$、角度 $\theta_0 + s \cdot 0.42\pi$ の中継点 $P_{\text{turn}} = (75 \cos(\theta_0 + s \cdot 0.42\pi), \; 75 \sin(\theta_0 + s \cdot 0.42\pi))$ に向かい、**等速直線移動（速度 $V_1 = 28.0\text{ px/s}$）** する（約10.7秒間、スイープ5回分ずっと完全な一直線を描く）。
  - **フェーズ2（最終コア突入）**: $P_{\text{turn}}$ 到達後、原点 `(0, 0)` に向かって速度 $V_2 = 32.0\text{ px/s}$ で直進突入する。
- **自機到達までの総猶予時間**: **約 12.0 秒**（スイープ検知回数：5〜6回）。

### Round 2: `ORBITAL SPIRAL`（等角速度スパイラル接近）
- **コンセプト**: 直線ではなく「一定の曲率で回り込みながら近づく弧」を読み、角度のリード（先読み）を大きく取って撃ち抜く。
- **初期配置**: 距離 $r_0 = 340\text{ px}$、初期方位角 $\theta_0$。
- **移動アルゴリズム（極座標更新式、経過時間 $t$）**:
  - 半径方向速度（接近速度）：$v_r = -24.0\text{ px/s}$（一定）
  - 角速度（旋回速度）：$\omega_{\text{enemy}} = s \cdot 0.28\text{ rad/s}$（約 $16.0^\circ\text{/s}$、一定）
  $$r(t) = 340 - 24.0 \cdot t$$
  $$\theta(t) = \theta_0 + s \cdot 0.28 \cdot t$$
- **自機到達までの総猶予時間**: $r(t) \le 34\text{ px}$ まで **12.75 秒**（スイープ検知回数：6回）。

### Round 3: `PHANTOM ACCEL`（2段階変速＋微旋回）
- **コンセプト**: 残像ブリップ間の距離の広がりから「敵の急加速」を察知し、リード幅を広げて撃つ。
- **初期配置**: 距離 $r_0 = 350\text{ px}$、初期方位角 $\theta_0$。
- **移動アルゴリズム**:
  - 緩やかな旋回角速度：$\omega_{\text{enemy}}(t) = s \cdot 0.18\text{ rad/s}$（常時一定）
  - **フェーズ1（ステルス低速接近：$r > 230\text{ px}$、$0 \le t < 6.0\text{ s}$）**:
    $$v_{r1} = -20.0\text{ px/s}$$
  - **フェーズ2（ブースト急加速：$r \le 230\text{ px}$、$t \ge 6.0\text{ s}$）**:
    - 距離 $230\text{ px}$ を割った瞬間からエンジンのブーストがかかり、接近速度が **2.1倍** に跳ね上がる。
    $$v_{r2} = -42.0\text{ px/s}$$
- **自機到達までの総猶予時間**: フェーズ1（6.0秒）＋ フェーズ2（4.67秒）＝ **10.67 秒**（スイープ検知回数：5回）。

### Round 4: `ZIGZAG VECTOR`（周期反転・折れ線フェイント軌道）
- **コンセプト**: 一定周期で旋回方向（右回り⇔左回り）を切り返すジグザグ接近。切り返し周期を読むか、切り返し直後に「戦術パルス」を打って確定軌道を抜く。
- **初期配置**: 距離 $r_0 = 350\text{ px}$、初期方位角 $\theta_0$。
- **移動アルゴリズム**:
  - 半径方向速度：$v_r = -26.0\text{ px/s}$（一定）
  - 旋回角速度：**3.6秒周期**で符号が反転する矩形波（折れ線）軌道。
    $$\text{phaseIndex} = \lfloor t / 3.6 \rfloor$$
    $$\omega_{\text{enemy}}(t) = s \cdot (-1)^{\text{phaseIndex}} \cdot 0.38\text{ rad/s} \quad (\text{約 } \pm 21.8^\circ\text{/s})$$
  - すなわち $t = 3.6\text{ s}, 7.2\text{ s}, 10.8\text{ s}$ のタイミングで鋭角に切り返す。半径は $r = 256\text{ px}, 163\text{ px}, 69\text{ px}$ の距離リング付近が変針ポイントとなるため、プレイヤーは距離リングを目印に変針位置を予測できる。
- **自機到達までの総猶予時間**: **12.15 秒**（スイープ検知回数：6回）。

### Round 5: `DUAL ECHO`（デコイ伴走・高速ステルスボス）
- **コンセプト**: レーダー上に「2つの反応（本物1機＋電子デコイ1機）」が同時に現れる最終試験。弾は1発しかないため、**理不尽にならない3つの明確な法則**から本物を見極めて射抜く。
- **初期配置**:
  - **本物（`main`）**: $r_{\text{main}}(0) = 350\text{ px}, \quad \theta_{\text{main}}(0) = \theta_0$
  - **デコイ（`decoy`）**: $r_{\text{decoy}}(0) = 350\text{ px}, \quad \theta_{\text{decoy}}(0) = \theta_0 + s \cdot 0.65\text{ rad}$（約 $37^\circ$ 離れた位置から同時スタート）
- **移動アルゴリズム**:
  1. **本物（`main`）の軌道（安定した高速スパイラル接近）**:
     $$r_{\text{main}}(t) = 350 - 28.0 \cdot t$$
     $$\theta_{\text{main}}(t) = \theta_0 + s \cdot 0.32 \cdot t$$
     - 本物は一定の接近速度（$-28.0\text{ px/s}$）と一定の旋回角速度（$0.32\text{ rad/s}$）で、真っ直ぐ自機コア（$r \le 34\text{ px}$）を殺しに来る。
  2. **デコイ（`decoy`）の軌道（角速度の脈動＋内周での外向き離脱）**:
     $$r_{\text{decoy}}(t) = 350 - 28.0 \cdot t + 22.0 \sin(1.8 \cdot t)$$
     $$\theta_{\text{decoy}}(t) = \theta_0 + s \cdot 0.65 + s \cdot (0.32 \cdot t + 0.22 \sin(1.5 \cdot t))$$
     - デコイは自機コアへの当たり判定を持たない（万一 $r \le 60\text{ px}$ に達した場合は外周方向へホバリング維持する）。
- **プレイヤーが「本物」と「デコイ」を見分ける3つの確定法則（理不尽排除設計）**:
  1. **【法則1：残像間隔の等速性（視覚パターン）】**
     - 本物は等速・等角速度のため、スイープごとの残像ブリップ間隔（$\Delta r \approx 56\text{ px}$）が**定規で測ったように完全に均等かつ滑らかな弧**を描く。
     - 一方、デコイは正弦波の脈動（$\sin$ 項）が入っているため、**ブリップ間隔が「狭い→広い→狭い」と不自然に伸縮し、軌道が蛇行**して見える。
  2. **【法則2：戦術パルス（Tactical Ping）による確定スキャン】**
     - 右クリック／`Shift` で1回使える「戦術パルス」を放つと、デコイの電子偽装が剥がれ、**デコイ側のブリップが「赤紫／警告グリッチ波形（`FAKE / DECOY` マーク付き）」としてハイライト表示**される。戦術パルスを使えば100%確実に本物を特定できる。
  3. **【法則3：ソナーPing音の倍音差（聴覚ヒント）】**
     - 本物をスイープが通過した時は澄んだ正弦波ベースのソナーPing音が鳴るが、デコイを通過した時はわずかに周波数が揺らぐデチューン（矩形波混じりの電子音）が鳴る。
- **自機到達までの総猶予時間**: **11.28 秒**（スイープ検知回数：5〜6回）。

---

## 6. 勝敗確定後の「答え合わせ（Unveil & `minMissDistance`）」仕様

1発を発射して勝敗が確定した瞬間（`RESULT_CLEAR` または `RESULT_FAIL`）、暗闇を解除し以下の情報をレーダー上に完全開示する。

### 6.1 軌道と真の位置の完全開示（Unveil描画）
1. **敵の真の移動軌跡**: ラウンド開始（$t = 0$）から勝敗確定時刻（$t = t_{\text{end}}$）までの敵（本物およびデコイ）の座標履歴 `trajectoryLog`（`0.05秒` 刻みの座標配列）を実線（本物＝高輝度シアン／グリーン、デコイ＝破線グレー）で描画する。
2. **敵の勝敗確定時座標と当たり判定円**: 勝敗確定瞬間の敵の真の座標 `(enemy.x, enemy.y)` と有効当たり判定円（半径 `TARGET_RADIUS = 16 px` および弾込み有効半径 `22 px` の破線リング）を明示する。
3. **自機弾の通過軌跡**: 原点 `(0, 0)` から命中位置（または外周 `360 px`）までの弾道レーザーラインを描画する。

### 6.2 最短すれ違い距離 `minMissDistance` の算出仕様
弾が発射されてから飛翔中（`SHOT_FLYING` の全フレーム区間 $t \in [t_{\text{fire}}, t_{\text{end}}]$）において、**各フレームの弾座標 $P_{\text{bullet}}(t)$ とその瞬間の本物の敵座標 $P_{\text{enemy}}(t)$ の距離**を追跡し、その最小値を記録する。

- **各フレームの瞬間中心間距離 $d(t)$**:
  $$d(t) = \text{distSegmentToPoint}\big(P_{\text{bullet}}(t_{\text{prev}}), \; P_{\text{bullet}}(t_{\text{curr}}), \; P_{\text{enemy}}(t_{\text{curr}})\big)$$
- **最小中心間距離 $D_{\text{min}}$**:
  $$D_{\text{min}} = \min_{t \in [t_{\text{fire}}, t_{\text{end}}]} d(t)$$
- **最短すれ違い距離 `minMissDistance`（単位：px、小数第1位または整数丸め）**:
  $$\text{minMissDistance} = \max\big(0, \; \text{round}(D_{\text{min}} - R_{\text{hit}})\big) \quad (\text{ただし } R_{\text{hit}} = 22\text{ px})$$
  - **命中時（`RESULT_CLEAR`）**: `minMissDistance = 0` とし、代わりに中心からのズレ距離 `hitOffsetPx = round(D_min)`（`0〜22 px`、例：`BULLSEYE OFFSET: 4px`）を表示する。
  - **外れ時（`RESULT_FAIL: SHOT_MISSED` / `DECOY_BAITED`）**: 弾と敵の当たり判定の縁が最も近づいた瞬間の隙間距離 `minMissDistance`（例：`MISS BY 18 px`）と、その最短接近時刻における「弾の位置点」と「敵の位置点」を結ぶ誤差インジケータ線（赤色点線）を画面上に描画する。
  - **未発射での被弾敗北時（`RESULT_FAIL: CORE_BREACHED`）**: 弾を撃たずに被弾したため `minMissDistance = null` とし、画面には `NO SHOT FIRED - CORE BREACHED` と表示する。

---

## 7. スコア・ランク評価仕様

### 7.1 ラウンド別スコア算出式（命中クリア時のみ加算）
各ラウンドを撃破した際、以下の4項目の合計でラウンドスコア（最大 `10,000 pts`）を算出する。

1. **ベース撃破ボーナス（`Base Score`）**: `3,000 pts`
2. **暗闇予測ボーナス（`Blind Prediction Bonus`：最大 `3,000 pts`）**:
   - 敵（本物）が**最後にソナー（スイープまたは戦術パルス）で検知されてから、弾を発射するまでの経過時間** $\Delta t_{\text{blind}} = t_{\text{fire}} - t_{\text{lastDetected}}$ を評価する（「光った瞬間を反射で撃つモグラ叩き」より「暗闇の中で未来位置を読んで撃つ」ほど高得点）。
   $$\text{BlindBonus} = \text{ clamp}\Big(\text{round}\big(\frac{\Delta t_{\text{blind}}}{1.20} \times 3000\big), \; 0, \; 3000\Big)$$
   - $\Delta t_{\text{blind}} \ge 0.80\text{ s}$ の場合、特別称号タグ **`BLIND SNIPE!`** を表示する。
3. **精密射撃ボーナス（`Precision Bonus`：最大 `2,500 pts`）**:
   - 命中時の中心ズレ距離 `hitOffsetPx`（`0〜22 px`）が小さいほど高得点。
   $$\text{PrecisionBonus} = \text{round}\Big(\big(1 - \frac{\text{hitOffsetPx}}{22.0}\big) \times 2500\Big)$$
   - `hitOffsetPx <= 6 px` の場合、特別称号タグ **`BULLSEYE!`** を表示する。
4. **戦術パルス温存ボーナス（`No-Ping Bonus`：`1,500 pts`）**:
   - 戦術パルス（Tactical Ping）を使用せずに撃破した場合 `+1,500 pts`。使用した場合は `+0 pts`。

### 7.2 ラウンド評価ランク（S / A / B）と総合ランク
| ランク | ラウンドスコア条件 | 総合クリアランク条件（全5ラウンド合計スコア） |
| :--- | :--- | :--- |
| **RANK S** | `7,500 pts` 以上 | `37,500 pts` 以上 |
| **RANK A** | `5,500 〜 7,499 pts` | `27,500 〜 37,499 pts` |
| **RANK B** | `5,499 pts` 以下 | `27,499 pts` 以下 |

---

## 8. 画面・状態遷移と0.5秒即時リトライ仕様

### 8.1 状態（Scene State）一覧と遷移図
ゲームは以下の6つの確定状態（`state`）を持つ。

```
[TITLE]
   │ (Click / Space / Enter : ゲーム開始、Round 1へ)
   ▼
[BRIEFING] ──(1.2秒経過 または Click / Space / Enter で即時スキップ)──► [PLAYING]
   ▲                                                                      │   │
   │                                           (左Click / Space: 弾発射) ◄─┘   │ (敵が r <= 34px 到達)
   │                                                      │                   │
   │                                                      ▼                   ▼
   │                                                [SHOT_FLYING]      [RESULT_FAIL]
   │                                                  │       │         (CORE_BREACHED)
   │                             (本物に命中 d<=22px) ◄┘       └► (r_bullet >= 360px 到達)
   │                                      │                                   │
   │                                      ▼                                   ▼
   │                               [RESULT_CLEAR]                      [RESULT_FAIL]
   │                                 │        │                         (SHOT_MISSED)
   ├──(Round 1〜4: Next Round)───────┘        │                               │
   │                                          ▼ (Round 5 クリア後 Next)        │
   │                                     [ALL_CLEAR]                          │
   │                                          │                               │
   └──(Rキー / Click: 同ラウンド即時リトライ)─┴───────────────────────────────┘
```

### 8.2 各状態の振る舞いと入力ルール
1. **`TITLE`（タイトル画面）**:
   - 背景でデモ用のソナースイープが回転。操作説明（マウス照準・左クリック1発射撃・右クリック戦術パルス）を表示。
   - 左クリック / `Space` / `Enter` で Round 1 の `BRIEFING`（または直接 `PLAYING`）へ遷移。
2. **`BRIEFING`（ラウンド開始演出：最大1.2秒）**:
   - ラウンド番号・コードネーム（例：`ROUND 2 / 5 : ORBITAL SPIRAL`）と軌道特性の1行ヒントを表示。
   - `1.2秒` 経過で自動的に `PLAYING` へ遷移。演出中でも左クリック / `Space` / `Enter` で即座に `PLAYING` へスキップ可能。
3. **`PLAYING`（索敵・照準フェーズ）**:
   - ソナー・スイープが回転し、敵が移動する。敵本体は不可視であり、ブリップと残像のみが描画される。
   - **左クリック / `Space` / `Enter`**: 照準方向へ1発を発射し、`SHOT_FLYING` へ遷移。
   - **右クリック / `Shift` / `E`**: 戦術パルス（1回限定）を発動。
   - **`R` キー**: いつでも現在ラウンドを `0.1秒` 以内に最初からリスタート可能。
4. **`SHOT_FLYING`（弾飛翔フェーズ：最大0.36秒）**:
   - 徹甲弾が `1000 px/s` で飛翔。敵およびスイープの物理更新も継続する。
   - 本物に命中すれば `RESULT_CLEAR`、外周 `360 px` に到達すれば `RESULT_FAIL` へ即座に遷移。
5. **`RESULT_CLEAR`（撃破成功・答え合わせ画面）**:
   - 敵の破砕エフェクトとともに、敵の全移動軌跡・命中位置・`hitOffsetPx`・スコア内訳・ランク（S/A/B）を表示。
   - **入力ガード時間**: 誤クリック防止のため遷移後 `0.25秒` のみ入力ガードを設け、`0.25秒` 経過後は以下の入力を即座に受け付ける（**0.5秒以内の高速遷移保証**）：
     - 左クリック / `Space` / `Enter`: 次のラウンドの `BRIEFING`（Round 5クリア時は `ALL_CLEAR`）へ即時遷移。
     - `R` キー: 同ラウンドを即時リトライ（スコア更新狙い用）。
6. **`RESULT_FAIL`（敗北・答え合わせ画面）**:
   - 敗北理由（`SHOT MISSED` / `DECOY BAITED` / `CORE BREACHED`）、敵の真の軌道と現在位置、自機弾の軌跡、**`MISS BY XX px`（`minMissDistance`）** を明示。
   - **0.5秒即時リトライ仕様**: 遷移後 `0.20秒` の極短ガード後、**左クリック / `Space` / `Enter` / `R` キーのいずれか1つを押した瞬間に、`BRIEFING` 演出を挟まず直接同ラウンドの `PLAYING`（0.0秒時点）へ即時リセット＆再開**する。これにより敗北から0.5秒以内で次のトライへ復帰できる。
7. **`ALL_CLEAR`（全5ラウンド制覇画面）**:
   - 全5ラウンドの合計スコア、総合ランク（S/A/B）、各ラウンドの戦績一覧を表示。
   - 左クリック / `Space` / `Enter` / `R` キーで Round 1 から再挑戦、または `T` キーで `TITLE` へ戻る。

---

## 9. 受け入れテスト項目（自動検証ケース＆人間評価項目）

### 9.1 自動検証用の状態公開フック仕様（Programmer向け必須要件）
自動受け入れテストを実行可能にするため、`window.__GAME_STATE__` に以下のプロパティとテスト補助メソッドを公開すること。
- **参照プロパティ**:
  - `state`: `'TITLE' | 'BRIEFING' | 'PLAYING' | 'SHOT_FLYING' | 'RESULT_CLEAR' | 'RESULT_FAIL' | 'ALL_CLEAR'`
  - `round`: `1〜5` の現在ラウンド番号
  - `ammo`: `1` または `0`
  - `tacticalPingRemaining`: `1` または `0`
  - `sweepAngle`: 現在のスイープ角度（rad, `[0, 2π)`）
  - `targets`: 敵オブジェクト配列（`{ id: 'main'|'decoy', x, y, r, theta, visibleDirectly: false }`）
  - `blipHistory`: 検知されたブリップ配列（`{ targetId, x, y, r, theta, detectedAt, source, isDecoyEcho }`）
  - `bullet`: 弾の状態（`null` または `{ x, y, r, angle, active }`）
  - `lastResult`: 直近ラウンドの勝敗結果（`{ outcome: 'CLEAR'|'FAIL', reason, minMissDistance, hitOffsetPx, score, rank }`）
  - `totalScore`: 累計スコア
- **テスト制御メソッド**:
  - `window.__GAME_TEST__.startRound(roundNumber, seedOrInitialAngle)`: 指定ラウンドを確定初期角度で即座に `PLAYING` 状態で開始する。
  - `window.__GAME_TEST__.step(dtSeconds, stepsCount)`: 指定秒数分だけ物理・ゲームループを決定的に進める。
  - `window.__GAME_TEST__.aimAndFire(angleRad)`: 指定角度（rad）へ照準を向けて即座に1発を発射する。
  - `window.__GAME_TEST__.triggerTacticalPing()`: 戦術パルスを発動する。
  - `window.__GAME_TEST__.retryOrNext()`: リトライまたは次ラウンド進行を実行する。

### 9.2 機械的に確認できる自動受け入れテストケース（全10項目）

| ID | テスト項目 | 実行手順（自動スクリプト） | 合格条件（アサーション） |
| :--- | :--- | :--- | :--- |
| **AT-01** | **初期起動とTITLE状態検証** | ページ読み込み完了後、`window.__GAME_STATE__` を参照し、コンソールエラーの有無を確認する。 | コンソールエラー・未処理例外が `0件` であり、`state === 'TITLE'` であること。 |
| **AT-02** | **通常時の敵不可視とスイープ検知・ブリップ生成** | `startRound(1, 0.25 * Math.PI)` で開始直後（`t=0`）に `blipHistory.length === 0` かつ敵本体の直接描画フラグが `false` であることを確認。その後 `step(0.02, 100)`（2.0秒＝スイープ1周分）進行させる。 | 2.0秒経過後に `blipHistory.length >= 1` となり、記録されたブリップ座標 `(x, y)` が検知時刻の敵座標と一致すること。 |
| **AT-03** | **角度跨ぎ（$2\pi \to 0$）でのスイープ検知漏れ防止** | 敵の初期角度を $\theta_0 = 0.01\text{ rad}$（$0$度直後）に設定し、スイープが $2\pi - 0.1\text{ rad}$ から $0.1\text{ rad}$ を通過する区間を `dt = 0.04s` でステップ進行させる。 | $2\pi \to 0$ の境界跨ぎフレームにおいて検知漏れが起きず、確実にブリップが1件追加されること。 |
| **AT-04** | **戦術パルス（1回限定）の発動と回数制限** | `PLAYING` 状態で `triggerTacticalPing()` を呼び出し、`step(0.02, 15)`（0.3秒）進める。再度 `triggerTacticalPing()` を呼び出す。 | 1回目の発動で `tacticalPingRemaining === 0` となり、`source === 'pulse'` のブリップが生成されること。2回目の呼び出しは無視されること。 |
| **AT-05** | **1発必殺ルールと命中撃破（`RESULT_CLEAR`）** | Round 1 開始後、敵の現在位置と移動ベクトルから未来の交差角度 $\phi_{\text{hit}}$ を算出して `aimAndFire(phi_hit)` を実行し、`step(0.016, 30)` 進める。 | 発射直後に `ammo === 0` かつ `state === 'SHOT_FLYING'` となり、弾と敵の距離が `22 px` 以下に達したフレームで `state === 'RESULT_CLEAR'`、`lastResult.outcome === 'CLEAR'`、`lastResult.score >= 3000` となること。 |
| **AT-06** | **外れ確定判定と `minMissDistance` 算出（`RESULT_FAIL: SHOT_MISSED`）** | Round 1 開始後、敵とは正反対の方向 $\phi_{\text{miss}} = \theta_0 + \pi$ へ `aimAndFire(phi_miss)` を実行し、`step(0.02, 25)`（0.5秒）進める。 | 弾が `r >= 360 px` に到達した時点で `state === 'RESULT_FAIL'`、`lastResult.reason === 'SHOT_MISSED'` となり、`typeof lastResult.minMissDistance === 'number'` かつ `lastResult.minMissDistance > 0` が算出されていること。 |
| **AT-07** | **自機コア被弾による敗北判定（`RESULT_FAIL: CORE_BREACHED`）** | Round 1 開始後、弾を発射せずに `step(0.05, 300)`（15.0秒）進行させる。 | 敵の中心距離 $r \le 34\text{ px}$ に到達した時点で `state === 'RESULT_FAIL'`、`lastResult.reason === 'CORE_BREACHED'` となること。 |
| **AT-08** | **全5ラウンドの軌道アルゴリズムとRound 5デコイ識別** | Round 1〜5 を順次 `startRound(r, 0.5)` で開始し、各ラウンドで4秒間ステップ進行させて敵座標推移を検証。Round 5 では `targets.length === 2`（`main` と `decoy`）を確認し、`triggerTacticalPing()` を実行する。 | Round 1〜5 すべてで仕様通りの軌道移動が行われ、Round 5 で戦術パルス通過後にデコイのブリップに `isDecoyEcho === true` が記録されること。またデコイに弾を当てて外周に達した場合は `RESULT_FAIL` となること。 |
| **AT-09** | **0.5秒即時リトライ導線の検証** | `RESULT_FAIL` 状態に遷移後、0.25秒経過させてから `retryOrNext()`（または `R` キーイベント）を発火させる。 | `BRIEFING` を挟まず即座に同ラウンドの `state === 'PLAYING'`、`ammo === 1`、`tacticalPingRemaining === 1` にリセットされること。 |
| **AT-10** | **全5ラウンドクリアから `ALL_CLEAR` 遷移の完結検証** | Round 1〜5 を順番に命中撃破して進行させる。 | Round 5 を撃破した後の次遷移で `state === 'ALL_CLEAR'` に到達し、`totalScore > 0` が保持されていること。 |

### 9.3 人が遊んで判断すべき定性的評価項目（Playtest Criteria）
1. **軌道の読解可能性と納得感**:
   - 過去3〜4点のブリップ残像と距離リングを見ただけで、「直線なのか、曲がっているのか、加速したのか」が直感的に読み取れ、偏差射撃が決まった時に「自分の頭で読んで当てた！」という強い快感があるか。
2. **「答え合わせ（Unveil）」の納得感**:
   - 外した瞬間に表示される敵の真の軌道と `MISS BY XX px` の表示を見て、「あと少しリードを前に取るべきだった」「ここで折り返していたのか」と0.5秒で納得でき、すぐにもう1回やり直したくなるか。
3. **静寂とソナー音の緊張感**:
   - 敵が `DANGER_RADIUS (120 px)` 以内に迫った際のソナーPing音の高音化と警告表示により、引き付けて撃つか今すぐ撃つかのジレンマと緊張感が演出されているか。

---

## 10. Designer / Programmer への引き継ぎ事項

- **Designer への入力**:
  - 論理レーダー半径は `360 px`（キャンバス `960 × 720 px` の中央 `(480, 360)` が原点）。距離リングは `90, 180, 270, 360 px`、危険域リングは `120 px`、自機コアは `18 px`、敵本体半径は `16 px`、弾半径は `6 px`。
  - 照準レティクル脇への「距離＋着弾予測時間（ETA）」表示、ブリップ残像（最新点＋過去3点の減衰＆補助破線）、戦術パルス時のデコイ識別グリッチ表現、および勝敗確定時の「軌道アンベール＋最短すれ違い距離（`MISS BY XX px`）」の視覚レイアウト・配色・Web Audio API 効果音仕様を `design.md` にて定義してください。
- **Programmer への入力**:
  - 本仕様書の数式・パラメータ・状態遷移・`window.__GAME_STATE__` / `window.__GAME_TEST__` インターフェースをそのまま実装してください。特にフレームレート変動に強いスイープ角度跨ぎ判定（2.2節）と弾の線分衝突判定（4.3節）を確実に組み込んでください。