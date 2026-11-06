# 無限Wave 実装報告

## 2026-11-05 ユーザー追加：進化色の単色化・観測ラベル更新

### 結論と実装
- ユーザーの色に関する追加意見と、事前に読み取り限定で受けたDesigner結論を反映。進化色替え提案は採用決定扱いにせず、段階色を通常レーダー色へ統一。Designer提案どおり既存輪郭・装備・観測名で段階を伝え、追加装飾/多色化なし。
- `src/engine.js`: 今後の描画に段階色が誤用されないよう、未使用となった進化色メタデータを除去。系統、段階、名称、形状データは維持。
- `src/renderer.js`: 危険赤が進化色に埋もれない優先順へ修正。デコイのシアン、Overdrive/予測/パルス等の機能色を保持。進化段階装備線も通常/危険色に従う。最新観測点の名称・ID・距離/年齢を内側の3行ラベルとしてまとめ、Canvas端で測定文字幅・高さを基に位置補正。輪郭、名称データ、機動/Wave表、観測限定ルールは変更なし。
- `tests/endless.test.js`: 進化5種の単色と危険赤/デコイ/Overdrive色の優先、ラベル境界補正の2テストを追加（無限テストは従来15件から17件）。
- `tests/endless-browser.py`: 実ブラウザで5種の形状/最新名称、5.5秒経過した履歴点の減衰、危険中の進化名色、端のラベル範囲を確認し、1504×784/1600×900のスクリーンショットを追加。予測表示の確認は対象IDの履歴件数に即して判定するよう安定化。

### 実行検証（今回の差分）
- `node projects/vector-strike/tests/acceptance.test.js`: **16/16 PASS**（AT-01〜15 + Chromium E2E、キャンペーン10Rを含む）。
- `node projects/vector-strike/tests/endless.test.js`: **17/17 PASS**。今回追加の単色/危険色とラベル境界の2テストを含み、既存有限攻勢・状態遷移・観測回帰も通過。
- `node --check`（renderer.js / endless.test.js）とPython AST検査（endless-browser.py）PASS。
- 既存Chromium 140.0.7339.16で既存の操作・導線に加えて対象サイズ両方を再確認。1504×784と1600×900の双方でページ/console error 0、ブラウザ試験終了時に一時サーバ停止を確認。
- ブラウザでは5系統の観測表示、履歴ブリップ減衰後の最新名称/ID、危険域の進化名が赤、名前矩形がCanvas内に収まることを計測。スクリーンショットを `tests/artifacts/endless/1504-radar-evolution-lineages.png`, `1504-radar-danger-evolved.png`, `1600-radar-evolution-lineages.png`, `1600-radar-danger-evolved.png` に保存し、全4枚を実際に開いて目視確認。
- 既存ブラウザ試験の他スクリーンショットも今回の表示で再生成されたが、個別の目視対象にはしていない（上記4枚のみ目視）。
- 初回ブラウザ実行でCanvasが返す色の小文字正規化、および既存の「選択IDに観測2点がない場合にも予測必須」とする不安定条件を検出。色比較を大文字小文字非依存にし、予測有無を対象IDの履歴数に合わせて検査して再実行、最終PASS。機能失敗を隠したものではなく、履歴1点なら予測なしを正とする仕様に沿ったテスト安定化。
- 既存の通常RAF 70秒ランは再実行せず（今回の差分は描画/テストのみ）。以前のリアルタイム検証結果は `endless-realtime-report.md` に維持。今回の制御fixtureは自然プレイ評価ではない。人間の視認性・難易度/学習・音響聴感、別ブラウザ/実機は未検証。

### 棚卸し（今回差分）
- `game-production-inventory/SKILL.md` のゲートと `references/lessons.md` の索引、関連する `ui-and-feedback.md` / `state-and-input.md` / `engine-and-verification.md` / `ergonomics-and-balance.md`、既存 `shared-assets/README.md` を参照。
- 単色化・警告色優先はこのレーダー固有の情報階層とDesigner結論に結び付く。文字位置補正もRenderer/canvas依存。汎用知見は既存UIの階層・矩形検証項目と重なり、独立再利用コードにもなっていない。画像は作品固有の証跡。
- **新規共通知見・共有アセット追加なし**。共通スキル/台帳や依存は変更せず、本作品資料とテストに保持。

## 2026-11-05 P実装継続・現行結果

### 再開時点と解消した残作業
- 最初に既存production、engine/main/renderer/audio、関連テストを確認。Gitなしのため基準コミットとの差分は取得不可。既に入っていた有限イベント表、軌道5種、3段階フェーズ、HUD/音、EW-11〜13の途中実装を保全して継続した。キャンセルIDに対する結果取得・同目的再調査・追加agentは不要だった。
- 未完だった進化系統の観測表示、安全クリアの達成演出、既存ブラウザfixtureの旧cap前提、テスト境界/計測時間、数値根拠、実ブラウザ確認、資料・棚卸しを完了。
- 中断テストのEW-12は7.99秒まで全敵を除去して8.00秒の締め終了で休息になるのが正しい。期待値を修正。EW-13は終盤の最終敵が自然突破するまで30秒を測定（旧20秒では不足）。
- 二段変針後2回観測の保守的余裕が初期値2.841秒だったため、ウイングIIIの動径を22→20px/sへ調整して3.742秒を確保。新能力に速度上昇を重ねず読み直しを優先。
- 新しいCanvasメソッド挿入位置の構文エラーを修正して全試験再実行。スクショ目視で上中央のフェーズ帯が北側観測を覆う問題を発見し、レーダー外の左上隅へ移動、再撮影・再検証。下端の進化名は内向きに配置。
- 以前から残っていた本作品のテストサーバPID174244（18945番、14:41開始）を特定して終了。acceptanceのブラウザ失敗時`process.exit`を例外へ変更しfinallyを通すよう修正、サーバ終了もawait。最終確認で18945/18946/18947番の本作品検証サーバなし。他作品8080番は触れていない。

### 現行実装・根拠
- `buildEndlessWavePlan`を唯一の有限スコアとし、処理待ちcap/バックログなし。総数3/3/4/4/5/5/6/6/7/7/8…、攻勢8.0/8.0/9.2/9.2/10.4/10.4/10.4/10.4/12.8…秒。高Waveは順序・方位関係・既知軌道を循環し、長時間化/無限物量/高速化しない。
- 教えるW2/4/6/8は直前Waveと出現時刻・総数を一致。W3/5/7は既知要素の重なり/連発。新軌道・速度・間隔・物量を一度に全て難化しない。
- ランスI（直進）→II（双発推進器、18→24px/sの加速）、ウイングI（旋回）→II（可動翼、一段変針）→III（二重翼、二段変針）。基底輪郭・装備・観測名で段階を伝え、段階色には依存しない。HP増加なし。
- 変針は齢3.2〜4.4秒、二段目6.4〜7.6秒、最大角速度±0.06rad/s。射撃/照準との因果なし。基本動径22、二段変針20、総速度32上限。観測形状/進化名は凍結したform情報をブリップへ記録し、その時点の観測だけから描画。隠れた実敵の座標や進化はHUD/予測へ転送しない。
- 増援終了は危険継続として別表示。残敵0かつ弾/pulse終了後のみ3秒の安全休息。Wave印が0.65秒で静止、撃破/突破/残コアとカウントを表示。REST解決和音は4音、全体約0.83秒で止まり、残りは静けさ。次Wave具体種の予告なし。
- キャンペーン10R、個体別観測予測、2秒装填、コア5、休息3秒、パルス1、弾速/直撃/爆風、入力ガード、モード切替、再挑戦、960×720固定・最低1504×784を保持。

### 本継続で編集したファイル
- `src/engine.js`, `src/main.js`, `src/renderer.js`, `src/audio.js`
- `tests/endless.test.js`, `tests/acceptance.test.js`, `tests/endless-browser.py`, `tests/endless-realtime.py`
- 既存資料 `production/endless-wave.md`, 本報告, `production/endless-realtime-report.md`
- `tests/artifacts/endless/*.png`（対応サイズの現行シナリオを再撮影、進化前後・静穏・次Waveを追加。旧証跡は削除せず保持）
- `index.html`/`style.css`は中断時のHUD/フェーズ対応をそのまま利用し、本継続では編集なし。既存の企画・デザイン・独立レビュー判定を書き換えていない。他作品・共通設定・依存manifest・共有台帳の変更なし。

### 実行した試験（最終実装で全て終了コード0）
ワークスペース `/old/work/games` から：
```sh
node projects/vector-strike/tests/acceptance.test.js
node projects/vector-strike/tests/endless.test.js
/home/natsuki/work/nas/.venv/bin/python -c 'import runpy; runpy.run_path("projects/vector-strike/tests/endless-browser.py", run_name="__main__")'
/home/natsuki/work/nas/.venv/bin/python -c 'import runpy; runpy.run_path("projects/vector-strike/tests/endless-realtime.py", run_name="__main__")'
```
- **既存16/16 PASS**：キャンペーン全10R、単発勝敗、デコイ、スコア、入力、viewport不足警告、固定Canvasを実Chromium含め回帰。
- **無限15/15 PASS**：予定時刻・有限性・増援/安全分離、残敵あり同時出現、複数撃破の統計、無効射撃、2秒装填、休息中新規敵/射撃/pulseなし、休息後パルス/入力ガード、0HP・結果固定、再挑戦/タイトル、観測限定予測、段階導入・進化、射撃非依存機動、遅延込み外れ復帰。
- 無射撃W1は0/3.2/6.4秒、W11は0/3.2×2/6.4/8.8×2/11.2×2秒に出現。いずれもHP5のまま全予定数出現（初回突破前）。W11はブラウザでも12.8秒に8体生存・増援終了を確認。処理待ちcapなし。
- **84ラン**：W4/6/8/11/30/100/10000×12初期方位。全敵の自然突破を測るためテストだけHP1000、射撃なし。他の移動・予定・観測は通常実装。全ラン30秒以内に安全休息。最大同時8、履歴28、総速度29.9982px/s、出現誤差約1.94e-13秒、変化後2回観測→突破の保守的最小猶予3.7417秒。
- **36復帰条件**：変針/加速/二段変針×12方位。対象だけ隔離した実軌道fixtureで、変化後2観測→認識0.5秒→故意の外れ→装填2秒→再照準0.25秒→観測限定予測射撃。36/36撃破、コア無傷、撃破時最小残猶予1.533秒。全Wave勝率や人間の難度判定ではない。
- 定常直進/旋回fixtureの288位相：初検知最大1.58秒、2観測→突破10.699秒、予測誤差最大2.316px（観測更新なし最大1.6秒）、入力遅延0.25秒の仮定で直撃余裕18.185px。変化中・全連続位相の保証ではない。
- **実ブラウザ** Chromium140.0.7339.16、1504×784/1600×900各シナリオPASS、page/console error 0。マウス/Space/Enter、右クリック/Shift/E、長押し/遷移入力、結果/再挑戦、モード切替、キャンペーン全10R、矩形検査。W2/4/6/8は実生成/実スイープで進化を観測し、前後の軌跡を描画・撮影（Wave選択と時間だけはテスト制御）。
- **通常RAF各70秒**：ゲーム状態/時間/真座標を書き換えず観測だけからブラウザ入力。両サイズでW1〜5の安全クリア、W5休息に到達。コア5、撃破19、命中19/発射20、最大同時4。意図した外れ→装填→再射撃、増援終了・残敵あり→クリア→次Wave、W4進化種を実表示。成功率は人間難度合格の根拠にしない。
- JS構文検査（src4ファイル・tests2ファイル）、Python2本AST検査PASS。ビルド/型検査の仕組みは元々ない。Node26のlocalStorage ExperimentalWarningのみ。Python直接ファイル起動で既存環境のPlaywright importが1回失敗したが、既存報告のrunpy経由で再現性を持って実行でき、インストールなし。

### スクショ目視・未検証
全て作品内 `tests/artifacts/endless/`。viewで実際に開いて確認した代表：
- `1504-realtime-cleanup.png`：増援終了でも生存反応が残り、スイープ継続。
- `1504-realtime-quiet.png`：残敵/弾/pulseなし、停止スイープ、WAVE01 CLEAR印・撃破内訳・休息表示。
- `1504-realtime-next-wave.png`：通常RAFで次Waveへ再開、装填/パルス復元。
- `1504-realtime-evolution.png`：通常RAFのW4ウイングII。
- `1504-evolution-wave2.png`, `1504-evolution-wave4-before.png`, `1504-evolution-wave4.png`, `1504-evolution-wave8-before.png`, `1504-evolution-wave8.png`, `1600-evolution-wave6.png`：単色化前の旧証跡。撮影当時の段階色/名称と、基底輪郭・追加翼/推進器、観測履歴の曲がりを確認。現在の単色表示は冒頭の追加検証画像を参照。
- `1504-reinforcements-ended-survivors.png`, `1600-rest.png`等も開いて確認。最新の通常RAFクリア証跡を優先し、fixtureの出現0/0は自然進行の証拠にしない。
- 自動入力による実ブラウザ操作/画像目視であり、人間が実機でプレイしたとの主張はしない。人間の学習・楽しさ・8体判断負荷、耳での音量/和音/安堵の聴感、他ブラウザ、長時間連続ランは未検証。近接時に名前/履歴/予測が重なる場面は残る。独立レビュー判定・ユーザー最終承認は実施していない。

### 棚卸し（今回実施）
- `/old/work/games/.github/skills/game-production-inventory/SKILL.md`、`references/lessons.md`、`state-and-input.md`、`ergonomics-and-balance.md`、`ui-and-feedback.md`、`engine-and-verification.md`、`/old/work/games/shared-assets/README.md`を参照・比較。
- 実証→差分振り返り→知見/モジュール/証跡の3フィルターを適用。予定攻勢/2系統進化/クリア印/音は作品状態・DOM・機動データに結合。猶予計測・AI限界・入力/矩形/連続衝突は既存知見と重複。画像/シード結果は作品固有の証跡。
- **新規共通知見・共有アセット追加なし**。共有更新の必要なし、共通領域は変更しない。今回の失敗修正と数値根拠はこの作品資料に保持。

---
以下は初回実装時の履歴。旧cap/数値/試験件数は現行仕様ではない。

## 完了範囲
- 対象は `/old/work/games/projects/vector-strike` のみ。実装・自動検証・既存Playwrightによる実Chromium検証を完了。
- 根拠：承認済み `production/endless-wave.md`。設計資料・既存レビュー判定は変更していない。独立専門レビュー合格の判定は行っていない。
- スキル実パス `/old/work/games/.github/skills/game-production-inventory/SKILL.md` と同階層 `references/state-and-input.md`, `engine-and-verification.md`, `ui-and-feedback.md` を確認・参照。
- Git操作・初期化・公開、依存追加、外部素材/サービス利用、他作品/共通設定変更なし。

## 変更ファイル
| ファイル | 内容 |
|---|---|
| `src/engine.js` | 無限専用設定・個体生成・装填/補充/休止/突破/結果、発射単位統計、観測選択、タイトル初期化。キャンペーンはモード分岐の外で既存処理を保持 |
| `src/main.js` | モード開始/結果/UI、観測対象HUD、キーリピート・遷移ガード・フォーカス/native click二重発火防止 |
| `src/renderer.js` | 実敵属性でブリップ表示、個体ID、選択個体のみ予測、局所演出、無限で真位置一斉開示しない |
| `index.html` | 無限開始・最小HUD・結果/再挑戦・モード切替。既存初回ガイドの誤った閉じタグを修正 |
| `style.css` | モード選択、タイトル内容スクロール、disabled表示、数字幅安定 |
| `tests/endless.test.js` | 新規機械受入10件・速度/位相/観測/誤差測定 |
| `tests/endless-browser.py` | 既存Playwrightによる実ブラウザ入力/導線/矩形検査・撮影、検証サーバ終了処理 |
| `tests/artifacts/endless/*.png` | 2解像度×9画面、計18枚 |
| 本報告 | 実装根拠・検証・証跡・制約 |

`src/audio.js`、`tests/acceptance.test.js`、既存production資料は変更なし。

## 設計対応・具体化
- `mode=ENDLESS`、`PLAYING → WAVE_REST → PLAYING`、HP0で `ENDLESS_RESULT`。キャンペーンの10R/単発勝敗/距離スコア/デコイ処理とは分離。
- `enemy-N` は `isDecoy:false`・機動属性・個体別検知履歴を持つ実敵。発射は別IDと `hitCounted` で管理し、直撃/爆風/複数撃破でも命中発射数は1。
- コア5、突破1ダメージ、重複処理防止、HPは0で下限固定。結果スナップショットは固定。再挑戦はWave1・ラン全統計初期化、タイトル帰還も初期化。
- 発射起点2.0秒装填。不成立射撃は弾数/発射数/装填期限を変更しない。飛翔中も照準・パルス入力を処理。
- W+2体、同時上限min(4,W+1)、初回1体、以後実出現間隔3.2秒以上。満枠後に一括補充しない。
- 全予定敵・飛翔弾・パルス判定完了後3.0秒休止。休止中発射/パルス禁止、装填は進む。新Waveはパルス1回へ復元。
- 外周340/突破34、動径22〜26px/s。W1直進、W2以降は直進と緩い旋回を混在。委任された旋回値は±0.045rad/s（外周でも総速度32px/s未満）。新規デコイ/急加速/切返しなし。
- 照準に最も近い最新観測個体を選択し、観測だけから既存予測関数で計算。実座標を変えても予測が不変であることを試験。
- 弾速1000・直撃半径28・爆風44を既存から共用。既存どおり照準地点で1回炸裂し、弾は最大射程360まで継続。弾/敵の相対線分による連続直撃判定。
- 命中率は命中した発射数/全発射数、0発は「—」。速度・装填・休止・耐久の説明は設定参照。
- Space/Enter・R等は新規押下のみ。遷移時250msガード、キー保持管理、UIボタンのkeyboard/native clickの所有者一本化、操作後のフォーカス解除。
- 承認設計からの既知の機能差異なし。旋回係数・局所表示・短い入力ガードは委任範囲の具体化。既存HTML閉じタグ修正は右HUDの見切れ解消のため。

## 起動・操作
ワークスペース `/old/work/games` から：
```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory projects/vector-strike
```
ブラウザで `http://127.0.0.1:8000/`。終了はCtrl+C。

タイトルの「作戦開始」＝既存キャンペーン、「無限Wave 防衛開始」＝別防衛モード。
マウス照準、左クリック/Space/Enter射撃、右クリック/Shift/Eパルス。既存矢印/WASD照準・Control微調整を保持。R再挑戦、TまたはTITLE/MODEでタイトル、Mミュート。

## 実行検証と結果
すべて `/old/work/games` で実行、最終結果は終了コード0。
```sh
node projects/vector-strike/tests/acceptance.test.js
node projects/vector-strike/tests/endless.test.js
/home/natsuki/work/nas/.venv/bin/python -c 'import runpy; runpy.run_path("projects/vector-strike/tests/endless-browser.py", run_name="__main__")'
node --check projects/vector-strike/src/engine.js
node --check projects/vector-strike/src/main.js
node --check projects/vector-strike/src/renderer.js
node --check projects/vector-strike/tests/endless.test.js
```
- 既存受入：AT-01〜15＋実Chromium E2E **16/16 PASS**。全10Rクリア・失敗・デコイ・スコア・初回ガイド・マウス操作の回帰試験通過。
- 無限機械受入：**10/10 PASS**。実敵ID/属性、3.2秒間隔・同時4体上限、2秒境界・無効射撃、直撃+爆風の重複防止、判定待ち3秒休止、同時突破/0終了固定、0発、観測のみの選択/予測、再挑戦/タイトル初期化。
- 真座標によるテスト専用迎撃oracleで自然なW1〜W3を完走、12撃破/12命中発射/12発、HP5でW4開始。これは攻略・人間プレイ評価ではない。
- 固定表示領域を **960×720 CSS px** とし、左右HUD・ヘッダー込みの最低ビューポートを **1504×784** に設定。未満では開始できない警告を表示し、Canvasは縮小しない。
- 既存Python Playwrightを使用。Chromium **140.0.7339.16**、最低寸法 **1504×784** と余裕を持った **1600×900** で両モードを検証。1280×720は警告表示・固定Canvasサイズを受入テストで確認。
- 実マウスで観測対象を切替、左クリック射撃・右クリックパルス、UIパルス後Space、フォーカスEnter開始/再挑戦、キー長押し・リピート・R直後貫通防止、装填中/飛翔中/休止途中入力、複数撃破・同時突破・100%結果・0発結果・タイトル/モード切替を確認。
- ブラウザでもキャンペーン全10R→最終報告、外れ→再挑戦を確認。主要ボタン/説明/HUD/canvasの個別矩形・横はみ出し検査通過。pageerror/console error **0件**。
- ブラウザシナリオはRAFを止め、テストフックで時間を進めた再現試験。別の通常RAFページで矢印照準・M・Tを実入力検証。人間の体感確認ではない。
- ビルド/型検査設定は元々なし。既存の直接ES modules実行とNode構文検査を使用。Node26の機械試験にlocalStorage未指定のExperimentalWarningが出たが、失敗ではなく、ブラウザエラーもなし。

### 機械指標（人間の難易度判定ではない）
5度刻み72位相×W1/W2/W9/W100＝288条件、dt0.01秒。旋回は両符号、観測後の未更新時間0/0.4/0.8/1.2/1.6秒も測定。

| 指標 | 実測 |
|---|---:|
| 最大総移動速度 | 30.165px/s（上限32以下） |
| 初回検知最大遅延 | 1.580秒 |
| 2回目観測→コア突破の最小猶予 | 8.569秒 |
| 観測予測の最大位置誤差 | 1.935px |
| 仮定する人間入力遅延 | 0.25秒 |
| 直撃誤差余裕：28−予測誤差−速度×0.25 | 18.524px |
| 爆風誤差余裕：44−予測誤差−速度×0.25 | 34.524px |

位相サンプルと理想的な操作遅延モデルの結果であり、全連続位相・人間の照準ミス・判断負荷を保証しない。

## スクリーンショット・見た目確認
`tests/artifacts/endless/{1504,1600}-{title-guide,title,multiple-enemies,reload-miss,rest,wave2,result,campaign-fail,campaign-complete}.png`

保存画像を実際に開き、タイトル説明/初回ガイド、複数IDの観測、休止/装填、無限結果、キャンペーン失敗/最終報告の表示を確認。例：
- [複数敵](../tests/artifacts/endless/1504-multiple-enemies.png)
- [無限結果](../tests/artifacts/endless/1600-result.png)
- [休止](../tests/artifacts/endless/1600-rest.png)
- [キャンペーン最終報告](../tests/artifacts/endless/1600-campaign-complete.png)

## 修正履歴・制約・リスク
- 初回ブラウザ試験で追加HUD更新の配置ミスと既存ガイド閉じタグに起因する右HUD見切れを検出・修正。休止境界の試験ステップと自然敗北までの待ち時間も修正し、上記最終試験を再実行。
- Pythonをファイル指定で直接起動した最初の試験ではこの環境でPlaywright importが失敗。既存受入と同じ仮想環境の `-c` 経由では利用でき、上記runpyコマンドで再現可能。インストールによる回避なし。
- 検証専用HTTPサーバは各試験のfinallyでterminate/wait、Chromiumもclose。最終プロセス確認で18945/18946の検証サーバ・Playwright driver残存なし。常駐サーバは残していない。
- **人間による連続プレイの体感・学習容易性・難易度・聴感は未確認**。音は既存合成音を使用したが、スクリプトによるAPI実行を聴感評価とはしない。
- 長時間の無限ラン、288サンプル外の全位相、Firefox/Safari、最低ビューポート未満・タッチ端末は未検証。最低サイズ未満ではゲーム入力が無効になる。対応サイズでの個体ラベルの人間による可読性・複数敵の読み分けは未検証。
- 累積観測ログは無限専用で有効ブリップ範囲に制限し、撃破/突破個体を退場させて際限ない履歴蓄積を回避。

## 棚卸し
新規の共通知見・共有アセット追加なし。既存の入力貫通防止・個別矩形検証・連続衝突の引き出しを適用したもので、新規汎用成果はない。作品固有のコード/テスト/証跡は作品内に保持し、共通領域は変更していない。
