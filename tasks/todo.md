# kusakuzushi 実装プラン

設計: ../DESIGN.md(リポジトリルートの DESIGN.md)が正。ここは実行計画。

## Constraints

| Constraint | Source | Verify by |
|------------|--------|-----------|
| core は DOM/fetch 非依存の純粋 TS | DESIGN.md §1 | core/src に fetch/document 参照がないこと(grep) |
| データ源はアダプタで差し替え可能 | DESIGN.md §2 | core が ContributionGrid 型のみに依存 |
| リポジトリは private で作成 | セッション1判断(公開は明示指示待ち) | gh repo view |
| モデルルーティング: scaffold=haiku, 実装=sonnet, レビュー=reviewer(opus) | ~/.claude/rules/behavior.md | 各 Agent 呼び出し |
| 区切りごとにセッション分割(S1:core, S2:web, S3:OGP, S4:拡張) | ユーザー指示 2026-07-24 | 各セッション末尾でコミット+push済みであること |
| コミットに Co-Authored-By: Claude | システム規約 | git log |

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| jogruber API は {date,count,level} フラット配列を返す | VERIFIED | 2026-07-24 curl 実測(DESIGN.md §2) |
| 同 API は CORS 許可 | VERIFIED | access-control-allow-origin: * 実測 |
| GitHub 草 DOM は td.ContributionCalendar-day + data-level/data-date | VERIFIED | 2026-07-24 curl 実測、375セル |
| node v26 / pnpm 10.30 / gh(toshi0607@github.com, repo scope) 利用可 | VERIFIED | 2026-07-24 コマンド実測 |
| jogruber API のレート制限は個人利用で問題ない | UNVERIFIED | アダプタ分離で緩和。Phase 2 で自前 Worker 化の判断 |

## セッション1: リポジトリ + core エンジン

- [x] 環境確認(node/pnpm/gh) — 実測済み
- [ ] git init + 初回コミット(DESIGN.md, tasks/, .gitignore) + gh repo create(private) + push
- [ ] モノレポ scaffold(→ haiku): pnpm-workspace, root package.json, tsconfig base, packages/core 骨格, apps/web(Vite vanilla-ts)骨格, CI(GitHub Actions: install+test)
      検証: `pnpm install` exit 0
- [ ] core エンジン実装(→ sonnet): model/grid変換/physics/game/renderer + Vitest
      検証: `pnpm -F @kusakuzushi/core test` exit 0、全テスト pass
- [ ] フェーズゲート: reviewer(opus) で core レビュー、Critical/High は修正
- [ ] コミット + push、セッション2への引き継ぎメモを本ファイルに追記

## セッション2: Web アプリ MVP(未着手)

- [ ] jogruber API アダプタ(fetchGrid)
- [ ] UI: ユーザー名入力 → プレイ → リザルト(?user= クエリ対応)
- [ ] X intent 共有 + canvas 画像保存
- [ ] Cloudflare Pages デプロイ(wrangler 認証はユーザー操作が必要な可能性)
- [ ] カスタムドメイン kusakuzushi.toshi0607.com 設定(toshi0607.com の DNS 管理場所を要確認。Cloudflare 管理なら Pages から直付け、他社なら CNAME)
- [ ] 草ゼロユーザーの「崩す草がありません🌵」画面

## セッション3: OGP Worker + 演出(未着手)
## セッション4: Chrome 拡張(未着手)

## Notes

- 2026-07-24: gh のデフォルトホストが github.gatech.edu のため、github.com 操作は GH_HOST=github.com を明示する

## Review

(レビュー結果をここに記録)
