# Harness

Harness は、既存リポジトリの品質チェックを安全に統一する Codex プラグインです。`lint`、`format`、`typecheck`、`test`、`build` を capability として扱い、すでに定義されている package script を根拠とともに選択します。

- 新しい品質ツールを自動導入しない
- `harness-settings.json` の明示設定を検出結果より優先する
- Hook が無効でも同じCLIで検証できる
- イベントは対象リポジトリの `.harness/` にだけ保存し、外部サービスやGitHub Issueを自動更新しない

同梱の `git-github-via-git` Skill は、commit / fetch / pull / push をGitコマンドだけで実行するためのワークフローです。GitHub CLIやAPIを利用しません。

## 必要条件

- Codex CLI またはCodexアプリ
- Node.js 18以降（Harness CLIの実行用）
- 対象リポジトリで利用するパッケージマネージャー（npm / pnpm / Yarn など）

## 1. Codexへプラグインを追加する

GitHub 上の Marketplace を追加してインストールします。リポジトリを手元に clone する必要はありません。

```bash
codex plugin marketplace add Inoue416/harness-plugins --ref main
codex plugin add harness@harness
```

更新版を取得するには次を実行します。

```bash
codex plugin marketplace upgrade harness
```

導入状態は次で確認できます。

```bash
codex plugin list
```

Codexアプリで導入する場合は、アプリを再起動または更新して `Harness` Marketplace を選択し、`Harness` をインストールしてください。SkillやHookを確実に読み込ませるため、導入後は**新しいスレッド**で試してください。

## 2. Hookを確認・信頼する

Harnessは `PreToolUse`、`PostToolUse`、`Stop` Hookをバンドルしています。CodexはプラグインのコマンドHookを自動信頼しないため、初回は `/hooks` で内容を確認し、信頼してください。

- `PreToolUse`: ルート・ホームへの再帰削除、破壊的Git操作、明白な秘密情報の入力、`.env` 等の保護ファイルへの自動編集を拒否します。
- `PostToolUse`: `lifecycle.postEdit` に指定したチェックだけを非同期実行します。既定は空です。
- `Stop`: 軽量チェックとすべての `required` capabilityを実行します。`required` の失敗・未解決、設定エラーは一度だけ修正の継続を要求します。advisoryの失敗は通知のみです。

Hookは補助的なガードです。Hookを利用しない環境でも、後述する `verify` が正規の再現可能な検証経路です。

## 3. 対象リポジトリで使う

対象リポジトリで Codex を開き、新しいスレッドで Harness を依頼してください。`HARNESS_PLUGIN_DIR` や `PATH` の設定は不要です。Harness Skill は、Codex にインストールされたプラグインの CLI を毎回自動検出して実行します。

```text
$harness-doctor このリポジトリを診断して。
```

`detect` は `package.json` scripts、ロックファイル、主要設定ファイルを読み、各capabilityについて選択したコマンド・provider・confidence・根拠をJSONで返します。`doctor` は設定不整合、未解決のrequired capability、直近の実行失敗、イベント保存状態、Hookの扱いを区別して報告します。

## 4. Harness設定を導入する

まずdry-runで具体的な提案を確認します。導入まで依頼されている場合は、その許可の範囲で書き込みまで進めます。提案のみの依頼では書き込みません。

```text
$harness-adopt このリポジトリに Harness を導入して。まずは dry-run の提案だけ表示して。
```

内容を確認して承認できる場合だけ、設定ファイル・スキーマコピー・`.gitignore` の `.harness/` エントリを作成します。

```text
上の Harness 導入案を承認します。設定を書き込んでください。
```

`adopt --write` は既存の `harness-settings.json` を上書きしません。既存設定がある場合は手動で差分を統合してください。

生成される設定の例です。

```json
{
  "version": 1,
  "quality": {
    "lint": { "mode": "required", "strategy": "changed" },
    "format": { "mode": "required", "strategy": "changed" },
    "typecheck": { "mode": "advisory", "strategy": "affected" }
  },
  "lifecycle": {
    "postEdit": [],
    "stop": ["lint", "format", "typecheck"]
  },
  "execution": { "timeoutMs": 120000, "maxOutputBytes": 8192 },
  "guards": {
    "dangerousCommands": { "mode": "required" },
    "protectedFiles": { "mode": "required" },
    "secrets": { "mode": "required" }
  },
  "promotion": { "mode": "advisory", "issueMode": "manual" }
}
```

既存scriptと異なるコマンドを使う必要がある場合だけ、capability単位で明示overrideできます。

```json
{
  "version": 1,
  "quality": {
    "lint": {
      "mode": "required",
      "strategy": "all",
      "provider": "eslint",
      "command": "pnpm lint:strict"
    }
  }
}
```

`mode` は `off`、`advisory`、`required` のいずれかです。`required` だけが `verify` の終了コードを失敗にします。`strategy` は `changed`、`affected`、`all` を指定できます。現在のMVPはprovider非依存の安全性を優先し、部分実行用の確実なコマンドを特定できない場合は `all` にフォールバックし、その理由を結果へ表示します。

不正な設定は終了コード2です。requiredの未解決、実行失敗、タイムアウト、イベント保存失敗は成功扱いしません。`lifecycle.stop` に含まれないrequiredも実行します。`verify --phase postEdit` は明示されたチェックだけが対象です。

自動検出するformatコマンドは `format:check` / `check:format` のみです。従来の `format` だけを持つリポジトリでは、読み取り専用か確認したうえで `quality.format.command` を指定してください。明示コマンドは変更せず実行するので、副作用のあるスクリプトも実行され得ます。

各コマンドの既定上限は120秒、stdout/stderr各8 KiBの末尾です。`execution` で変更できます。省略した出力は `outputTruncated`、時間切れは `timedOut` と終了コード124で報告します。Hookには全体でPostToolUse 15秒、Stop 35秒の予算があります。超過時は手動CLIで必要なチェックを完了してください。macOS/Linuxでは時間切れにプロセスグループを停止します。Windowsでは直接の子プロセスのみが対象です。

既存設定は自動移行しません。旧設定の `postEdit: ["format"]` も引き続き有効です。編集ごとの全体実行を減らすには、対象リポジトリの設定を `postEdit: []` に変更します。Hookと手動CLI間の成功キャッシュは実装していません。

## 5. 日常の使い方

対象リポジトリで Codex を開始し、必要な Skill を指定します。どの操作でも環境変数やプラグインの保存先を指定する必要はありません。

```text
$harness-doctor 現在の設定と検出結果を診断して。
$harness-promote ローカルイベントを分析して、改善候補を提示して。
```

ターミナルから CLI を直接使う場合だけ、次の一行でインストール済みプラグインを自動解決できます。シェル設定への追記や再起動は不要です。

```bash
node "$(codex plugin list | awk '$1 ~ /^harness@/ { path = $NF "/scripts/harness.mjs" } END { print path }')" doctor
```

`promote analyze --write` は `.harness/dashboard.md` を生成します。提案はローカルかつadvisoryであり、設定変更、依存追加、GitHub Issue作成は自動で行いません。

## 6. Codexへの依頼例

新しいスレッドで、次のように依頼できます。

```text
Harnessでこのリポジトリを診断し、検出根拠と未解決のcapabilityを報告して。
```

```text
既存ツールを変更せずにHarness導入案を作って。書き込み前に差分を説明して。
```

```text
Harnessのローカルイベントを分析し、設定変更はせずに改善候補を提示して。
```

## Astra / Sol / Terra / Lunaで開発する

```text
$harness-work この変更を実装し、既存の品質チェックで検証してください。
```

`harness-work` は現在のモデルが明示されていればそのガイドだけを読み、共通の作業・検証フローを適用します。CLIからは `node codex-plugins/harness/scripts/harness.mjs guide --model gpt-6-astra` で確認できます（このリポジトリ内の例）。`--model` を省略すると共通ガイドだけを返します。

| モデル | このプラグインでの指示の焦点 |
| --- | --- |
| `gpt-6-astra` | 許可済み作業の完遂、指示の矛盾解消、適量の検証、途中指示でも目的を保持 |
| `gpt-5.6-sol` | 複雑な作業の完了条件を定義し、調査・仕上げの範囲を明確にする |
| `gpt-5.6-terra` | 影響するインターフェースと確認方法を絞り、段階的に実装する |
| `gpt-5.6-luna` | 入出力・対象ファイル・合格条件を具体化し、小さな単位で検証する |

ガイドは助言であり、モデルの自動切替や推論量の強制を行いません。サブエージェントもセッションで許可され、独立した仕事を分担できる場合だけ使用します。各モデルの実測性能を保証するものではありません。

話題のastra向け推論状態維持・compactionは、モデルAPIまたはCodexホストの機能です。このプラグインにはAPIクライアントがなく、会話状態を再構築したり、推論履歴を収集したりしません。設定の選択肢、一次情報、評価方法は [モデル対応の設計根拠](../../docs/knowledge/model-aware-harness.md) を参照してください（ソースリポジトリ内）。

## イベントとプライバシー

実行結果は `.harness/events.ndjson` に保存され、`promotion` の集計に使用されます。保存するのはcapability、provider、成否、所要時間、変更ファイル数、ハッシュ化したsession IDなどの最小メタデータです。ソース本文、環境変数値、秘密値、コマンド引数の生値は保存しません。

## トラブルシューティング

| 状況 | 対処 |
| --- | --- |
| プラグインが表示されない | `codex plugin marketplace add Inoue416/harness-plugins --ref main` 後に `codex plugin list` を確認し、新しいCodexスレッドを開始してください。 |
| Hookが実行されない | `/hooks` で信頼状態を確認してください。Hookが無効でも `verify` を実行できます。 |
| capabilityが未検出 | `doctor` で根拠を確認し、必要なら `harness-settings.json` に `command` を明示してください。 |
| `adopt --write` が拒否される | 既存の `harness-settings.json` を保護しています。提案を確認して手動統合してください。 |
| 検証が遅い | `postEdit` と `lifecycle.stop` を確認し、高速な既存scriptを指定してください。requiredはStopで省略されません。大きい検証はCLIで実行できます。 |
