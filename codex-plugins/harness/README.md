# Harness

既存のコマンドを使って変更を検証する Codex プラグインです。ユーザーが依頼で示した完了条件、リポジトリの `AGENTS.md`、CI、`harness-settings.json` を開発スキルの判断材料にします。検証の順序と合否は Node.js の CLI が決定します。

## 導入

Node.js 18 以降と、対象プロジェクトが使うツールを用意してください。Marketplace からのインストールは次のとおりです。

```bash
codex plugin marketplace add Inoue416/harness-plugins --ref main
codex plugin add harness@harness
codex plugin list
```

Marketplace の更新は `codex plugin marketplace upgrade harness` です。新しいスレッドでスキルを使用し、Hook は `/hooks` から内容と信頼状態を確認できます。CLI を手動で使う場合、下記はこのソースリポジトリのルートから実行する例です。インストール済みのスキルは自身の配置場所を基準に CLI を解決します。

```bash
node codex-plugins/harness/scripts/harness.mjs plan --root /path/to/project
```

## 日常の使い方

| やりたいこと | スキルまたは CLI |
| --- | --- |
| 変更を実装し、利用者の操作経路を検証する | `$harness-work` |
| 使用するコマンドと検出根拠を調べる | `detect`、`$harness-doctor` |
| 設定とチェックを導入する | `$harness-adopt`、提案は `adopt`、書き込みは `adopt --write` |
| 既存の設定を更新する | `$harness-update` |
| 実行予定・前提条件を確認する | `plan`、Hook 側の既定値を見るには `plan --hook` |
| 一部のチェックとその前提を実行する | `run test --summary` |
| 完了時の検証を行う | `verify --summary` または従来の `run stop` |
| 過去の失敗と回復から改善案を作る | `$harness-promote`、`promote analyze` |
| Git でブランチやリモートを操作する | `$git-github-via-git` |

`adopt --write` は設定ファイル、スキーマのコピー、ローカルイベント用の `.gitignore` エントリを作成します。設定ファイルがすでにある場合は提案のみを返します。既存設定があるときの提案はその設定を返します。新規設定の Stop は検出できた lint・format・typecheck を優先し、これらがない場合は検出済みの test または build を1件選びます。

## 依存グラフの設定例

次の例は対象プロジェクトに `typecheck`、`test`、`build` と `test:ui` がある場合です。型検査とテストを並列に実行でき、両方の成功後にビルドし、その出力を使って画面を検証します。

```json
{
  "version": 1,
  "quality": {
    "typecheck": { "mode": "advisory" },
    "test": { "mode": "required" },
    "build": { "dependsOn": ["typecheck", "test"] },
    "ui-smoke": {
      "command": "npm run test:ui",
      "mode": "required",
      "dependsOn": ["build"]
    }
  },
  "lifecycle": { "postEdit": [], "stop": ["ui-smoke"] },
  "execution": { "maxParallel": 2, "timeoutMs": 120000, "maxOutputBytes": 8192 }
}
```

- 自動検出の対象は Node.js 系の `lint`、`format`、`typecheck`、`test`、`build` です。言語を問わず `quality.<名前>.command` で既存のプロジェクトコマンドを指定できます。独自名は英小文字で始まり、英小文字・数字・ハイフンを使えます。`stop` と `constructor` は予約名です。
- `dependsOn` は成功が必要な前提です。1回の検証で同じ名前のチェックは1回だけ実行します。循環や未知の依存先があると、コマンドを開始する前に診断を返します。
- 並列数の既定値は1、設定範囲は1〜8です。共有する生成物・ポート・DB があるコマンドは順序を定義するか、直列設定を使ってください。上限は1回の CLI または Hook 呼び出しごとに適用されます。
- `off` は無効、`advisory` は結果を報告、`required` は成功を必須とします。前提が無効・未解決・失敗なら後続は `blocked` となり、`blockedBy` に直接の原因が入ります。独立したチェックは続行します。上の例では型検査の失敗でも `ui-smoke` が保留され、全体は失敗します。
- 自動検出する整形チェックは `format:check` と `check:format` です。明示コマンドはそのまま実行します。`strategy` が `changed` または `affected` でも、対象を限定するインターフェースのないスクリプトは全体を実行し、詳細結果に理由を含めます。

## 結果と修正ループ

`verify --summary` は各チェックの状態、所要時間、実行件数、保留件数を返します。成功時の標準出力を省き、失敗時には標準出力・標準エラーの末尾を残します。コマンド、検出元、イベントを含む詳細は通常の `verify` や `doctor` で確認できます。

| 結果 | 読み方 |
| --- | --- |
| `passed` | 実行したチェックが成功 |
| `findings` | advisory の失敗または未解決項目あり |
| `no-checks` | 検証の実行件数がゼロ |
| `failed` | 必須チェックが失敗、未解決、または保留 |

`verify` は必須チェックが完了しなければ終了コード1、設定・グラフ不正なら2です。`run CHECK` は指定したチェックの終了コードを返します。修正時は最初に完了しなかった前提とエラーを確認し、原因を直して再検証します。確認できた範囲と未解決事項を最終報告に残します。

各コマンドは既定120秒、出力は標準出力・標準エラーごとに末尾8 KiBです。時間切れは `timedOut`、切り詰めは `outputTruncated` で確認できます。macOS/Linux では時間切れにプロセスグループを停止し、Windows では直接の子プロセスを停止します。

## Codex Hook

- `PreToolUse` はシェル・パッチ入力の既知の危険なパターンを確認します。各ガードのモードに応じて警告または拒否を返します。
- `PostToolUse` は `lifecycle.postEdit` とその前提を非同期で実行します。既定のリストは空で、全体の時間予算は15秒です。
- `Stop` は設定したチェックとすべての必須チェックを35秒の予算で検証します。未設定時の Hook 側の候補は lint、format、typecheck です。必須の失敗・設定不正に対する自動継続は1回です。手動の `verify` では Hook の時間予算外で検証できます。

実行メタデータは対象プロジェクトの `.harness/events.ndjson` に記録します。Hook のセッション ID はハッシュ化し、ログ本文やコマンド引数は記録しません。`promote analyze --write` で集計と改善案を `.harness/dashboard.md` に保存できます。改善案の適用はユーザーが選べます。

## 0.2 系からの移行

設定は引き続き `version: 1` です。既存の有効な定義には依存追加や並列化を行わず、明示された `postEdit`、コマンド、required 設定を引き継ぎます。以前は警告だけだった未知の capability 名を独自チェックとして使うには `command` を指定してください。スペルミスのある品質設定と未定義のフェーズは `doctor` または `plan --phase 名前` で確認できます。コピー済みの JSON Schema は必要に応じて同梱の `schemas/harness-settings.schema.json` に更新してください。

`guide --model ID` は指定されたモデルを保持し、対応する短い助言を返します。未登録のモデルやモデル ID が不明な場合も共通ガイドが使えます。課金、推論量、モデルの選択は Codex 側の設定に従います。
