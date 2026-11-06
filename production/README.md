# VECTOR STRIKE（旧名: BLIND RADAR SHOT） — 制作資料インデックス（正本案内）

## 1. 現在のステータス
- **フェーズ**: **実装・自動／ブラウザ検証済み、両専門レビューは体験目標REVISE**（2026-11-06 23:22実装承認）。機能・数値は肯定、危険赤の仕様不一致と方策比較条件に指摘あり。修正・追加監査案と体感の最終承認はユーザー確認待ち。
- **最終更新日**: 2026-11-06
- **現在の実装範囲**: [plan.md §4.6](./plan.md)・[level-design.md §6.6](./level-design.md) と各節の最終決定。共通敵・偽像とIII（60／72px/s）、予定攻勢延長、7／8／8枠循環を採用。P横変位は0.80秒、F基本方位差0.65rad。旧2系統5形態・全実敵・全敵32px/s以下の制約を置き換える。未承認の追加予兆UI・新音響・誤射詳細表示は実装範囲外。

### 再開時の引き継ぎ
- **最新指示**: 「OKです。実装してみましょう」。保留は解除済み、追加の実装前承認待ちはない。
- **担当と次工程**: Game Programmer実装・自動／ブラウザ検証済み → Game Director／Game Level Designerレビュー済み → 修正・追加監査案の承認 → 必要な修正・再検証 → ユーザー実プレイ確認。
- **難易度目標**: 初被弾W3〜4、III由来の圧力W6〜8、初敗北W9〜12は検証前の仮説。強制被弾や敗北保証にはしない。
- **経緯**: 旧5形態を固定した編成案を撤回し、共通ロスター＋IIIへ見直した。中断・復旧の記録は [verification-and-review.md](./verification-and-review.md) を参照。
- **検証状況**: キャンペーン16件・無限14件通過、方策比較と二画面サイズのブラウザ検証を実施。最新点撃ちも高い処理率であり体感改善は未確定。詳細は [verification-and-review.md §0](./verification-and-review.md)。

## 2. 起動・検証コマンド
- **起動方法**:
  ```bash
  python3 -m http.server 8000 --bind 127.0.0.1 --directory /old/work/games/projects/vector-strike
  ```
  ブラウザ（最低ビューポート `1504×784 px` 以上）で `http://127.0.0.1:8000/` を開く。
- **自動テスト**:
  - キャンペーン＆基本受け入れテスト（AT-01〜15 ＋ Chromium E2E）:
    `node /old/work/games/projects/vector-strike/tests/acceptance.test.js`
  - 無限Waveモード受け入れテスト（14件）:
    `node /old/work/games/projects/vector-strike/tests/endless.test.js`
  - 無限Wave観測限定方策・期限監査:
    `node /old/work/games/projects/vector-strike/tests/endless-policy.test.js`
  - 無限Wave実ブラウザ検証（Playwright Chromium）:
    `/home/natsuki/work/nas/.venv/bin/python -c 'import runpy; runpy.run_path("/old/work/games/projects/vector-strike/tests/endless-browser.py", run_name="__main__")'`
  - 無限Wave通常RAF 70秒リアルタイム検証:
    `/home/natsuki/work/nas/.venv/bin/python -c 'import runpy; runpy.run_path("/old/work/games/projects/vector-strike/tests/endless-realtime.py", run_name="__main__")'`

## 3. 最新の正本ドキュメント（Single Source of Truth）
`production/` 直下には**現在有効な最新の正本のみ（7ファイル）**を配置しています。仕様確認・実装・レビュー時は必ず以下の正本を参照してください。

| 正本ファイル | 役割・内容 | 現在の版・状態 |
| --- | --- | --- |
| [requirements.md](./requirements.md) | 要件定義・受け入れ基準（AC 1〜6）・固定プレイ領域・無限Wave要件 | 最新正本 |
| [direction.md](./direction.md) | 制作方針・体験の3本柱・10R拡張・無限Wave防衛方針 | 最新正本 |
| [plan.md](./plan.md) | 企画・ゲームルール・全10R仕様・距離比例スコア・無限Wave共通敵仕様 | 最新正本（§4.6実装承認済み） |
| [level-design.md](./level-design.md) | 難易度曲線・プラズマ炸裂・動的予測・角度位相監査・無限Wave猶予設計 | 最新正本（無限Wave改訂案・初心者到達目標は未検証） |
| [design.md](./design.md) | 画面レイアウト・敵固有形状・MK-II演出・無限Wave共通輪郭＆音響設計 | 最新正本（§3.3旧追加UI案は未採用） |
| [verification-and-review.md](./verification-and-review.md) | 最新の実装報告・自動/実ブラウザ/通常RAF検証結果・専門役レビュー判定 | 最新正本（キャンペーン＋無限Wave統合） |

## 4. 過去のリビジョン・履歴資料（アーカイブ）
統合前の個別仕様書・追加差分ドキュメント・過去レポートはすべて [archive/](./archive/) に保管しています。

- **企画・レベルデザイン個別資料**:
  - [archive/plan-r5-initial.md](./archive/plan-r5-initial.md)（初版5ラウンド企画仕様）
  - [archive/plan-r10.md](./archive/plan-r10.md)（WAVE 2: Round 6〜10 ＆ 距離減衰スコア拡張仕様）
  - [archive/level-design-r10.md](./archive/level-design-r10.md)（ヒューマンプロキシ監査＆R1〜R10リバランス単体仕様）
  - [archive/playability-followup.md](./archive/playability-followup.md)（初見プレイの情報整理・初回ガイド・640ケース角度位相監査）
  - [archive/endless-wave.md](./archive/endless-wave.md)（無限Waveモード企画・有限予定攻勢・単色化履歴）
- **デザイン個別資料**:
  - [archive/design-r5-initial.md](./archive/design-r5-initial.md)（初版UI・視覚・音響デザイン仕様）
  - [archive/design-enemy-shapes.md](./archive/design-enemy-shapes.md)（5系統の敵固有ブリップ＆シルエット仕様）
  - [archive/design-r10.md](./archive/design-r10.md)（Round 6〜10 OVERDRIVE視覚表現＆マルチデコイ仕様）
- **実装・検証・レビュー個別報告**:
  - [archive/implementation-report.md](./archive/implementation-report.md)（初版実装レポート）
  - [archive/review.md](./archive/review.md)（初版Directorレビュー）
  - [archive/endless-implementation-report.md](./archive/endless-implementation-report.md)（無限Wave実装・継続改修・単色化検証報告）
  - [archive/endless-realtime-report.md](./archive/endless-realtime-report.md)（無限Wave通常RAF 70秒検証・進化単色確認報告）
  - [archive/endless-review.md](./archive/endless-review.md)（無限Wave独立レビュー・棚卸し記録）
