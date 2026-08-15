# Codex Harness Plugin

`codex-plugins/harness` は、既存リポジトリの品質コマンドを検出・実行・診断する Codex プラグインです。既存のリンター、フォーマッター、テストランナーを無断で追加・置換・更新しません。

## はじめ方

1. [プラグインの導入・設定・運用ガイド](codex-plugins/harness/README.md) に従い、GitHub Marketplaceを Codex に追加します。
2. 新しいCodexスレッドで `Harness でこのリポジトリを診断して` と依頼するか、CLIで `detect` を実行します。
3. `adopt` の提案を確認してから、必要な場合のみ `adopt --write` で対象リポジトリへ設定を作成します。

ハーネス設計の根拠は [docs/knowledge/harness-engineering.md](docs/knowledge/harness-engineering.md) にまとめています。
