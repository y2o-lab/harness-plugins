# モデルに合わせたHarness改善

確認日: 2026-09-18。対象はCodex用プラグインであり、独自のモデルAPIランタイムではない。

## 一次情報と適用範囲

- [OpenAI: Using GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model): 許可済み作業の継続、スキルやAGENTS.mdの指示監査、検証量の調整、必要に応じた委譲を推奨。このプラグインでは承認の重複、過剰チェック、停止Hookの意味を修正した。
- [OpenAI: Models](https://learn.chatgpt.com/docs/models): Astraは難しい一連の作業、Solは複雑で自由度の高い作業、Terraは日常的な作業、Lunaは明確で反復可能な作業に適する。モデル別ガイドはこの区別を開発タスクへ適用した設計判断であり、各文面の優位性を実測したものではない。
- [OpenAI: Using GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model/gpt-5.6): persisted reasoningとツール実行の効率化は5.6にも関係する。特定の推論量を全タスクへ強制せず、既存選択を維持して比較する。
- [OpenAI: Hooks](https://learn.chatgpt.com/docs/hooks): Stopで作業を継続するには `decision: "block"` と `reason` を使用する。`stop_hook_active` で既に継続されたか判定し、無制限の修正ループを避ける。
- [ARC Prize: OpenAI's GPT-6 Astra on ARC-AGI-3](https://arcprize.org/blog/astra): 異なるハーネス条件で推論状態の保持と長い会話の圧縮が成績・実行効率に影響した一次報告。SNS等の議論はこの報告に照合した。ベンチマークは限定されたゲーム環境であり、このプラグインで同じ改善率が得られるとは主張しない。

## 実装した境界

1. `harness-work` と `guide --model` が共通フローと選択されたモデルの小さなガイドだけを読む。全モデルの指示を一括注入しない。既存skillsも共通のCLI解決・権限判断を参照する。
2. 新規設定のpostEditを空にし、編集ごとにリポジトリ全体のformatを実行しない。旧設定の明示postEditは保持する。formatの自動検出はcheck用の名前に限定し、一般のformatを暗黙に実行しない。
3. requiredの未解決や失敗を正しく終了コードへ反映する。advisoryは通知のみ。Stopは一度だけ修正を促し、その後の未解決事項は手動検証と報告に残す。
4. プロセス実行を独立モジュール化し、時間と出力を制限する。Hookは総時間予算も持つ。失敗・時間切れ・出力切詰めを明示する。モデルのコンテキストへ無制限のログを流さない。
5. doctorは直近の成功で回復した過去の失敗を未解決として繰り返さない。診断skillはコマンドを勝手に再実行してイベントを書き込まない。

## ホスト側の機能

このプラグインはモデルIDやCodex設定を書き換えない。独自APIループも追加していない。推論状態とcompactionをプラグインのイベントや手書きの要約に置換しない。長い作業では同じタスクを継続し、目的・制約・完了済み変更・検証結果・未完了事項という事実を保持する。

公式Modelsページには、対応クライアントのChatGPT Plus/Proログイン向けに `features.context_management.experimental_mode = true` が記載されている。これは任意の実験機能で、Business/Enterprise/API-keyログインでは公開時点で利用不可。このリポジトリの修正ではユーザーのグローバルconfig.tomlを変更せず、この機能を必須にしない。

将来独自APIランタイムを作る場合は、Astraのツール実行にResponses APIが必要であること、未対応のsampling引数、reasoning stateの維持、compaction item、ツールcall_idの対応を公式仕様と照合する。API側のキャッシュ、async tool calling、mid-turn steeringを「このプラグインで実装済み」と扱わない。

## 検証と性能評価

`npm test` はHookの終了・継続、required/advisory、設定不正、重複capability、timeout、出力制限、回復診断、4モデルのガイド選択をローカルで検証する。APIアクセスやモデル料金は発生しない。

モデル性能のA/B測定は別途必要。同じリポジトリ状態から、従来版と変更版へ同一の依頼・モデル・推論量・ツール・合格条件を与える。小さな修正、複数ファイルの機能追加、長時間のリファクタリング、曖昧な調査、失敗する検証の回復を代表タスクとする。成功率と成果物の品質を先に確認し、そのうえで総時間、トークン、ツール回数、不要な承認、チェックの重複を比較する。最大推論量や多くのサブエージェントを自動的に最適とはみなさない。

今回の自動テストはプラグインの動作検証であり、4モデルを用いた実タスクの品質・速度ベンチマークは実施していない。
