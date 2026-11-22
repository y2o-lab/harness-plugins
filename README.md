# Codex Harness Plugin

Harness は、リポジトリにある品質チェックを Codex から実行し、依頼の完了を実際の検証結果で確かめるプラグインです。モデルを問わず同じ合格条件を使えます。

```text
$harness-work この変更を実装して、利用者の操作経路とリポジトリの必須チェックで検証して。
```

- 導入、設定例、既存設定の移行は [プラグインガイド](codex-plugins/harness/README.md) を参照してください。
- 設計の根拠と調査した一次資料は [ハーネス設計](docs/knowledge/harness-engineering.md)、モデルの扱いと評価手順は [モデル対応と評価](docs/knowledge/model-aware-harness.md) にまとめています。

このチェックアウトでは次のコマンドを使えます。

```bash
npm run harness -- plan
npm run harness -- verify --summary
npm run bench:harness
```
