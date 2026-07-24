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
| jogruber API のレート制限は個人利用で問題ない | UNVERIFIED(許容) | 2026-07-24 実測: レート制限ヘッダーなし・公表値なしで外形検証不能。ただし x-cache: HIT でCDNキャッシュ確認済み(同一ユーザーへの連打は origin に届かない)。緩和策: fetchGrid アダプタ分離済み+障害時は自前 Worker プロキシへ差し替え(DESIGN.md §2)。Phase 2 で自前化を再判断 |

## セッション1: リポジトリ + core エンジン

- [x] 環境確認(node/pnpm/gh) — 実測済み
- [x] git init + 初回コミット + gh repo create(private) + push — https://github.com/toshi0607/kusakuzushi (96d2ccb)
- [x] モノレポ scaffold(→ haiku) — `pnpm install` / `pnpm -r test` exit 0 (47d8670)
- [x] core エンジン実装(→ sonnet) — テスト 29/29 pass、`tsc -p .` exit 0
- [x] フェーズゲート: reviewer(opus) — Approve、M1/M2 は同セッションで修正済み(回帰テスト2件追加、修正前コードで fail することも確認済み)。詳細は下の Review 欄
- [x] コミット + push、セッション2への引き継ぎメモ追記

### セッション2への引き継ぎ

- core の公開API: `toGrid`, `Game`, `DEFAULT_CONFIG`, `MAX_FRAME_DT`, `render`, `LIGHT_THEME`/`DARK_THEME`(packages/core/src/index.ts)
- **必須ガード(レビューM3)**: ブロック0個(草ゼロ)で launch すると即 clear になる。web 側で liveBricks 数を確認して「崩す草がありません🌵」を出すこと
- apps/web は scaffold のみ(main.ts は VERSION の console.log だけ)
- デプロイ先: Cloudflare Pages + カスタムドメイン kusakuzushi.toshi0607.com(toshi0607.com の DNS 管理場所を要確認)

## セッション2: Web アプリ MVP(未着手)

- [ ] jogruber API アダプタ(fetchGrid)
- [ ] UI: ユーザー名入力 → プレイ → リザルト(?user= クエリ対応)
- [ ] X intent 共有 + canvas 画像保存
- [ ] Cloudflare Pages デプロイ(wrangler 認証はユーザー操作が必要な可能性)
- [ ] カスタムドメイン kusakuzushi.toshi0607.com 設定 — toshi0607.com は Cloudflare 管理で確定(2026-07-25 ダッシュボード実見: Status Active, Free plan)。Pages のカスタムドメイン追加だけで DNS・証明書は自動
- [ ] 草ゼロユーザーの「崩す草がありません🌵」画面(レビューM3: ブロック0個で launch すると即 clear になるため必須ガード)

## セッション3: OGP Worker + 演出(未着手)
## セッション4: Chrome 拡張(未着手)

## Notes

- 2026-07-24: gh のデフォルトホストが github.gatech.edu のため、github.com 操作は GH_HOST=github.com を明示する

## Review

### セッション1 フェーズゲート(reviewer/opus, 2026-07-24)

判定: **Approve**(Critical/High なし)。検証: tsc --noEmit exit 0、vitest 27/27 pass。

| ID | Sev | 内容 | 対応 |
|----|-----|------|------|
| M1 | Medium | update(dt) が dt 未クランプ → タブ復帰時にボールがパドル/ブロックを貫通 | セッション1内で修正(回帰テスト付き) |
| M2 | Medium | パドルのコーナーヒットが left/right 判定になり取りこぼし | セッション1内で修正(回帰テスト付き) |
| M3 | Medium | ブロック0個だと launch 直後に即 clear。**セッション2の web 側で「崩す草がありません🌵」ガード必須** | セッション2に申し送り |
| L1 | Low | toGrid が366日+土曜開始で54週になり得る(下流は動的なので壊れない) | 保留(実害なし) |
| L2 | Low | liveBricks が名前に反して全ブロック返却 & 要素が可変 | 保留 |
| L3 | Low | 破壊パーティクルが常に最薄緑(破壊後 level=0 のため) | 保留(cosmetic) |
| L4 | Low | 拡張版(Phase 3)は count=0 のためスコア0になる → **拡張アダプタで count=level² を投入すること** | セッション4に申し送り |
| L5 | Low | 最終ブロック破壊とボール落下が同フレームだと loss 優先 | 保留(極稀) |
