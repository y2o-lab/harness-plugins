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
- `PostToolUse`: 編集後にformat capabilityを非同期で確認します。
- `Stop`: 設定済みの軽量品質チェックを実行します。`required` の失敗は修正を促します。

Hookは補助的なガードです。Hookを利用しない環境でも、後述する `verify` が正規の再現可能な検証経路です。

## 3. 対象リポジトリで使う

対象リポジトリで Codex を開き、新しいスレッドで Harness を依頼してください。`HARNESS_PLUGIN_DIR` や `PATH` の設定は不要です。Harness Skill は、Codex にインストールされたプラグインの CLI を毎回自動検出して実行します。

```text
$harness-doctor このリポジトリを診断して。
```

`detect` は `package.json` scripts、ロックファイル、主要設定ファイルを読み、各capabilityについて選択したコマンド・provider・confidence・根拠をJSONで返します。`doctor` は設定不整合、未解決のrequired capability、直近の実行失敗、イベント保存状態、Hookの扱いを区別して報告します。

## 4. Harness設定を導入する

まずは必ずdry-runで提案を確認します。

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
    "postEdit": ["format"],
    "stop": ["lint", "format", "typecheck"]
  },
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

## イベントとプライバシー

実行結果は `.harness/events.ndjson` に保存され、`promotion` の集計に使用されます。保存するのはcapability、provider、成否、所要時間、変更ファイル数、ハッシュ化したsession IDなどの最小メタデータです。ソース本文、環境変数値、秘密値、コマンド引数の生値は保存しません。

## トラブルシューティング

| 状況 | 対処 |
| --- | --- |
| プラグインが表示されない | `codex plugin marketplace add Inoue416/harness-plugins --ref main` 後に `codex plugin list` を確認し、新しいCodexスレッドを開始してください。 |
| Hookが実行されない | `/hooks` で信頼状態を確認してください。Hookが無効でも `verify` を実行できます。 |
| capabilityが未検出 | `doctor` で根拠を確認し、必要なら `harness-settings.json` に `command` を明示してください。 |
| `adopt --write` が拒否される | 既存の `harness-settings.json` を保護しています。提案を確認して手動統合してください。 |
| 検証が遅い | 現在のMVPは安全に部分実行できない場合、全体実行へフォールバックします。対象リポジトリの高速な既存scriptを明示指定してください。 |
