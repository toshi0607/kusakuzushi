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
| jogruber API のレート制限は個人利用で問題ない | UNVERIFIED-ACCEPTED(2026-07-24 ユーザー報告済み) | 実測: レート制限ヘッダーなし・公表値なしで外形検証は不可能。ただし x-cache: HIT でCDNキャッシュ確認済み(同一ユーザーへの連打は origin に届かない)。緩和策: fetchGrid アダプタ分離済み+障害時は自前 Worker プロキシへ差し替え(DESIGN.md §2)。Phase 2 で自前化を再判断 |

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

## セッション2: Web アプリ MVP(完了 2026-07-25)

- [x] jogruber API アダプタ(fetchGrid: parse を純関数に分離しユニットテスト) — `pnpm --filter @kusakuzushi/web test` exit 0(20 tests)
- [x] UI: ユーザー名入力 → プレイ → リザルト(?user= クエリ対応) — `pnpm -r build` exit 0
- [x] 草ゼロガード「崩す草がありません🌵」(レビューM3 必須。hasBricks が false なら Game を起動しない) — ユニットテスト済み(UI パスはコードレビューで確認)
- [x] X intent 共有 + canvas 画像保存(toBlob → download / Web Share API)
- [x] ブラウザで手動プレイ検証 — ?user=toshi0607 でグリッド描画・発射・gameOver→リザルト(スコア/共有URL/ボタン)・404エラー・ダークテーマを実証。※Browser ペーンは visibilityState=hidden で rAF/タイマー停止のため、rAF をキュー化して同期駆動する方式で検証(Notes 参照)
- [x] フェーズゲート: reviewer(opus) — Approve(Critical/High/Medium なし、Low 4件中3件は同セッションで修正済み。詳細は Review 欄)
- [x] コミット + push + PR、CI green — PR: https://github.com/toshi0607/kusakuzushi/pull/1(初回 CI fail → core exports を src 直指しに修正 6517649 → CI pass → マージ済み f625aa0)
- [x] Cloudflare Pages デプロイ — wrangler login(OAuth、ユーザー承認済み)→ project create → deploy。https://kusakuzushi.pages.dev で 200 配信確認(2026-07-25)
- [x] カスタムドメイン kusakuzushi.toshi0607.com — Pages へのドメイン追加は API、CNAME(kusakuzushi → kusakuzushi.pages.dev, Proxied)は claude-in-chrome でダッシュボードから作成(ユーザーが settings.local.json に mcp__claude-in-chrome 許可を追加して解決)。ダッシュボードの正規フロー(Set up a custom domain → Activate)で有効化し、status=active + https://kusakuzushi.toshi0607.com/ HTTP 200 実測(2026-07-25)

### セッション2 受け入れ基準(UI フロー)

- トップ: ユーザー名入力フォーム。`/?user=x` 直アクセスは即 fetch 開始
- fetch 中: ローディング表示。失敗(404/ネットワーク)は日本語エラー + 再入力可
- プレイ: マウス/タッチでパドル追従、←→キー対応。Space/クリック/タップで発射
- HUD は core renderer(Score/Life)。canvas 内部解像度 960x480、CSS で responsive 縮小
- clear/gameOver: リザルトオーバーレイ — スコア、刈り取り率(破壊ブロックの count 合計 ÷ grid.total)、X共有、画像保存、もう一回
- 共有テキスト: 「{user} の草 {total} contributions を {pct}% 刈り取った🌱 スコア {score}」 + `https://kusakuzushi.toshi0607.com/?user={user}`
- テーマ: prefers-color-scheme で LIGHT_THEME/DARK_THEME 切替

### セッション3への引き継ぎ

- 本番: https://kusakuzushi.pages.dev(project: kusakuzushi, production-branch: main, direct upload 方式)。デプロイコマンド: `pnpm -r build && cd apps/web && npx wrangler pages deploy dist --project-name kusakuzushi --branch main`
- wrangler は OAuth 認証済み(`npx wrangler whoami` で確認可)。Account ID: 5ee49b8e0983dc8fcf6d0eddb45ef5d8、toshi0607.com zone: ea6ad3e0ad5be8d094dd62dc14536b07
- カスタムドメインは有効化済み。X 共有 URL(share.ts の SITE_URL = kusakuzushi.toshi0607.com)も生きている
- Chrome 操作(claude-in-chrome)は .claude/settings.local.json の `mcp__claude-in-chrome` 許可ルールで可能(auto モードのクラシファイア拒否はこの許可で回避される)
- Cloudflare 公式プラグイン(cloudflare@cloudflare)インストール済み — **次セッションから Cloudflare MCP サーバーが使える**(OAuth は初回ツール使用時に自動)。DNS 操作もそちらで可能になる見込み
- git 運用: セッション2から PR 方式(branch → PR → CI green → API マージ)。`gh pr merge` はタイムアウトするので `gh api -X PUT .../merge` を使う

## セッション3: OGP Worker + 演出(完了 2026-07-25)

### Constraints(セッション3 追加分)

| Constraint | Source | Verify by |
|------------|--------|-----------|
| ゲームバランスは変えない(演出のみ) | セッション3指示 | game.ts/physics.ts の数値・ロジック無変更(diff) |
| 共有URLは /share/{user}?s={score} 形式、クローラーに OGP HTML・人間に本体リダイレクト | DESIGN.md §4 | curl UA 別レスポンス実測 |
| マージは `gh api -X PUT .../merge`(gh pr merge はタイムアウト) | セッション2 Notes | 実行コマンド |
| GH_HOST=github.com 明示 | セッション1 Notes | 実行コマンド |

### Assumptions(セッション3 追加分)

| Assumption | Status | Evidence |
|------------|--------|----------|
| Workers の CPU 制限内で satori+resvg の PNG 生成が動く | VERIFIED | 2026-07-25 本番実測: コールドの初回生成含め og.png が常に 200(1102 なし)。フォントは isolate 内キャッシュ + 完成 PNG は Cache API キャッシュ |
| Pages カスタムドメイン(kusakuzushi.toshi0607.com)に Worker route を張れる(routes が Pages より優先) | VERIFIED | 2026-07-25 spike Worker を route kusakuzushi.toshi0607.com/share/* にデプロイ → curl /share/toshi0607 が Worker 応答、/ は Pages 200 のまま |
| workers-og(satori)で日本語テキスト描画可(Google Fonts サブセット取得) | VERIFIED | 2026-07-25 本番 og.png で日本語描画確認。ただし workers-og の loadGoogleFont は text 未エンコードのバグがあり自前実装で回避(Notes 参照) |

### タスク

- [x] workers/ogp scaffold + 実装(→ sonnet、フォント/レイアウト修正はメイン): GET /share/{user}(UA判定: クローラー→OGP HTML / 人間→ 302)、GET /share/{user}/og.png(1200x630 PNG: 草グリッド SVG data-URI 埋め込み + 日本語テキスト)。`pnpm --filter @kusakuzushi/ogp test` 65/65 pass、`build`(tsc --noEmit)exit 0
- [x] apps/web share.ts の共有 URL を /share/{user}?s={score}&p={pct} に切替 — share.test.ts 追加、`pnpm --filter @kusakuzushi/web test` 23/23 pass
- [x] 演出: セッション1レビュー L3 修正 — renderer が brick の生存中 level を記録し、破壊パーティクルはその色を使う。renderer.test.ts 追加(修正前 fail → 修正後 pass を確認)、core 30/30 pass
- [x] wrangler deploy(route: kusakuzushi.toshi0607.com/share/*、version e8b47efc)+ web 再デプロイ(新バンドルに share/ URL を確認)
- [x] 検証: 下記「セッション3 検証記録」参照。X/Slack の実クローラー UA でのエンドツーエンド(HTML → og:image 抽出 → PNG 取得)を実証
- [x] フェーズゲート: reviewer(opus) — Approve(Critical/High/Medium なし、Low 3件は同セッションで全て修正・本番検証済み。詳細は Review 欄)
- [x] PR → CI green → API マージ — https://github.com/toshi0607/kusakuzushi/pull/5(CI test pass 24s → merge 1e16afc)。セッション4 への引き継ぎは下記

### セッション3 検証記録(2026-07-25 本番実測)

```
# クローラー(X): OGP HTML が返る
curl -s -A "Twitterbot/1.0" "https://kusakuzushi.toshi0607.com/share/toshi0607?s=7777&p=42"
# → og:title「toshi0607 の草を 42% 刈り取った🌱」/ og:image=...og.png?s=7777&p=42 / twitter:card=summary_large_image

# クローラー(Slack): 同上
curl -s -A "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" ...同URL... # → 同一 OGP HTML

# og:image を同 UA で取得 → PNG 実体
# → 200, 48118 bytes, PNG image data, 1200 x 630, 8-bit/color RGBA(草グリッド+日本語テキスト描画を目視確認)

# 人間(iPhone Safari UA): 302 → https://kusakuzushi.toshi0607.com/?user=toshi0607
# 不正 username: /share/bad..user → 404
# 存在しないユーザーの og.png: グリッド無しフォールバック PNG 200(jogruber 404 でも 500 にしない)
# Pages 本体: / は従来どおり 200(Worker route は /share/* のみ)
```

- 既知の制約(実測): opengraph.xyz / socialsharepreview.com などのプレビュー確認ツールは汎用 UA でフェッチするため 302 側に落ち、OGP を表示できない。X/Slack/Discord/FB/LINE 等の実クローラーは UA トークン(bot/crawler/spider/preview/externalhit/embedly/whatsapp/line//pinterest/mastodon/misskey/cardyb)で捕捉済み。誤判定で OGP HTML を受けた人間にはページ内リンクで本体導線あり
### セッション4への引き継ぎ

- OGP Worker 本番稼働中: route `kusakuzushi.toshi0607.com/share/*`(worker 名 kusakuzushi-ogp、workers/ogp/wrangler.toml)。デプロイ: `cd workers/ogp && npx wrangler deploy`。/share/{user}?s=&p= がクローラーに OGP HTML、人間に 302。/share/{user}/og.png が 1200x630 PNG(Cache API 24h、グリッド無しフォールバックは 5min)
- 共有 URL は share.ts の buildShareUrl が /share/{user}?s={score}&p={pct} を生成(旧 ?user= 形式は廃止だが / への 302 で後方互換不要)
- **セッション4 スコープ(DESIGN.md §5)**: apps/extension — Chrome 拡張 MV3。content script で GitHub プロフィールの草 DOM → グリッド化 → オーバーレイ canvas。破壊時に実 td の背景を level0 色へ。turbo:load 対応。**セッション1レビュー L4 の申し送り: 拡張アダプタでは count が取れないため count=level² を投入すること**(game.ts のスコアは brick.count 基準)
- ビルド方式は Vite + CRXJS か素の esbuild(DESIGN §6、Phase 3 で決定とされている)
- 検証は自分の GitHub プロフィールページで実施(DESIGN §7 Phase 3 完了条件)

## セッション4: Chrome 拡張(未着手)

## Notes

- 2026-07-24: gh のデフォルトホストが github.gatech.edu のため、github.com 操作は GH_HOST=github.com を明示する
- 2026-07-25: CI で web テストが「Failed to resolve entry for package @kusakuzushi/core」で fail(CI は core の dist 未ビルド、ローカルは過去ビルドの stale dist で偶然通っていた)。内部専用パッケージのため core の exports を src/index.ts 直指しに変更して解消。moduleResolution: bundler なので tsc/Vite とも src 直参照で問題ない
- 2026-07-25 (S3): workers-og@0.0.27 の `loadGoogleFont` は `text` パラメータを URL エンコードせず css2 URL に埋め込むため、サブセット文字列に生の `%` があると不正なパーセントエスケープになり、Google が日本語グリフ抜きのフォントを返す(cmap 実測: 正エンコード 79 グリフ/生 67 グリフ・日本語なし)。workers/ogp/src/fonts.ts で encodeURIComponent する自前ローダーに置き換えて解消
- 2026-07-25 (S3): satori(workers-og の HTMLRewriter パーサ)は `&nbsp;` 等の HTML 実体参照を解釈せずリテラル文字列として描画する。スペーシングは margin で行うこと
- 2026-07-25: Claude Code の Browser ペーンは visibilityState=hidden のため rAF・setTimeout が完全停止する。ライブプレイ検証は「requestAnimationFrame をキュー化して javascript_exec 内で同期的に drain する」ハーネスで実施(1フレーム=100ms の合成タイムスタンプ)。加えて viewport が一時的に 0px に崩壊する事象あり — resize_window(desktop) で復旧。getBoundingClientRect が 2px を返したらこれを疑う

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

### セッション2 フェーズゲート(reviewer/opus, 2026-07-25)

判定: **Approve**(Critical/High/Medium なし)。検証: pnpm -r test 49/49 pass、pnpm -r build exit 0、core 無変更確認、XSS/any/innerHTML なし確認。

| ID | Sev | 内容 | 対応 |
|----|-----|------|------|
| L1 | Low | リザルト画面でも Space の preventDefault が効き、フォーカスしたボタンを Space で押せない | 同セッションで修正(terminal state では素通し) |
| L2 | Low | gameOver/clear 後も rAF ループが 60fps で描画し続ける | 同セッションで修正(terminal state でループ停止、もう一回で新セッション) |
| L3 | Low | 共有テキストに桁区切りなし(DESIGN 例は 2,942 形式)+ #草崩し は設計例にない | 桁区切りは toLocaleString で修正。ハッシュタグは共有時の発見性のため意図的に維持(要ユーザー確認なら削除可) |
| L4 | Low | total.lastYear を検証するが未使用(toGrid が再計算)。理論上の不整合データ(level≥1&count=0)は実 API では発生しない | 対応不要と判断 |

### セッション3 フェーズゲート(reviewer/opus, 2026-07-25)

判定: **Approve**(Critical/High/Medium なし)。検証: pnpm -r test 118/118 pass、pnpm -r build exit 0、game.ts/physics.ts 無変更(バランス制約)、core の DOM/fetch 非依存維持、XSS/SSRF なし(username 正規表現バリデーション + 全埋め込み escapeHtml 経由 + fetch 先は固定ホストのみ)を確認。

| ID | Sev | 内容 | 対応 |
|----|-----|------|------|
| L1 | Low | jogruber 一時障害時のグリッド無しフォールバック PNG が 24h キャッシュされる | 同セッションで修正(フォールバック時は max-age=300。本番で 300 を実測) |
| L2 | Low | フォント取得/satori 例外が未捕捉で Worker 例外(1101)になる | 同セッションで修正(try/catch → no-store の 500) |
| L3 | Low | クローラー HTML に Vary: User-Agent がなく共有キャッシュ経由で人間に HTML が返り得る | 同セッションで修正(vary: user-agent 付与。本番で実測) |
