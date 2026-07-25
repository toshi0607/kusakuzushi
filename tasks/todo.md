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

## セッション4: Chrome 拡張(実装中)

### Constraints(セッション4 追加分)

| Constraint | Source | Verify by |
|------------|--------|-----------|
| packages/core は無変更(ゲームバランス不変) | セッション4指示 / DESIGN §3 | `git diff main -- packages/core` が空 |
| 拡張アダプタは count = level² を投入(セッション1 L4) | セッション1レビュー L4 / セッション4指示 | adapter のユニットテスト(count=1/4/9/16) |
| 破壊時に実 td の背景を level0 相当へ差し替える | DESIGN §5 | td-paint のユニットテスト + 実ページ実測 |
| 終了/遷移で原状復帰(DOM は破壊しない) | DESIGN §5 | teardown 後に td の style/属性が初期状態と一致(テスト) |
| turbo:load でのページ遷移に対応(多重初期化・リーク防止) | DESIGN §5 / セッション4指示 | 二重 mount しないこと・rAF/リスナ解放をテスト |
| セレクタとグリッド構築を1ファイルに隔離 | DESIGN §5 | grass-dom.ts 以外に `ContributionCalendar` 文字列が出ないこと(grep) |
| モデルルーティング: scaffold=haiku / 実装=sonnet / ゲート=reviewer(opus) | ~/.claude/rules/behavior.md | 各 Agent 呼び出し |
| マージは `gh api -X PUT .../merge`、`GH_HOST=github.com` 明示 | セッション1〜3 Notes | 実行コマンド |

### Assumptions(セッション4 追加分)

| Assumption | Status | Evidence |
|------------|--------|----------|
| 草 td は data-date / data-level / id=contribution-day-component-{row}-{col} を持つ | VERIFIED | 2026-07-25 実ページ実測(371セル、`data-ix`/`data-date`/`data-level`/`id` を確認) |
| セルは正方 10px、border-spacing 3px(縦横同一 stride 13px) | VERIFIED | 2026-07-25 getBoundingClientRect 実測: rect0 l=67 w=10 h=10 / rect1 l=80 / 行の t が 13px 刻み |
| `--color-calendar-graph-day-*-bg` の CSS 変数は :root では空。色は computed style から採る必要がある | VERIFIED | 2026-07-25 実測: 全変数が空文字。td の computedStyle は level0=rgb(239,242,245) 〜 level4=rgb(17,99,41) |
| core の computeLayout の幾何を実 td 座標に一致させられる(gap=実ギャップ, W=cols*stride+gap, H=2*(7*cellH+9*gap)) | VERIFIED | 実測値で解いて一致確認(下記「幾何の解」)+ ユニットテストで computeLayout の出力と実 rect の一致を検証 |
| ビルドは素の esbuild で足りる(CRXJS 不要) | VERIFIED | 調査(open-source-librarian, 2026-07-25): 単一 content script・popup/background なし・HMR不要。esbuild は core の exports(src/index.ts 直指し)を追加プラグインなしで解決 |
| 拡張の未パック読み込みはこのセッションからは自動化できない | UNVERIFIED-ACCEPTED(2026-07-25) | chrome://extensions はブラウザ MCP の操作対象外。代替として **実 github.com ページに実ビルド成果物(dist/content.js)を注入して**エンドツーエンド検証し、手動読み込み手順を下記に残す |

### 幾何の解(実測 10px セル / 3px ギャップ / 53週)

core の `computeLayout` は `brickWidth=(W-gap*(cols+1))/cols`, `brickAreaTop=gap`, `brickAreaHeight=H/2-gap`, `brickHeight=(brickAreaHeight-8*gap)/7` 固定。実 td に重ねるには:

- `gap = strideX - cellW`(実測 3)
- `canvasWidth = cols*stride + gap`(53*13+3 = 692)
- `canvasHeight = 2*(7*cellH + 9*gap)`(2*(70+27) = 194)
- オーバーレイの原点 = (col0,row0 セルの page 座標) - gap

→ ブロック矩形が実 td と1:1で重なる。盤面下半分(97px)がパドル空間になるため、`ballSpeed`/`paddle*`/`ballRadius` は狭い盤面向けに config で上書きする(core は無変更)。

### タスク

- [x] apps/extension scaffold(→ haiku): package.json / tsconfig / vitest(jsdom) / manifest.json / build.mjs(esbuild) / 実フラグメントのテストフィクスチャ(371セル)— `pnpm --filter @kusakuzushi/extension build` exit 0
- [x] grass-dom.ts: セレクタ + セル読み取り + 幾何計測(純関数に分離)— jsdom + 実 HTML フィクスチャで 6 tests pass
- [x] adapter.ts: cells → ContributionGrid(**count = level²**)+ deriveConfig — 10 tests pass(count=0/1/4/9/16、canvasWidth=692・canvasHeight=194、computeLayout の brickWidth/Height=10・brickAreaTop=3、全列で brick.x = 3+col*13)
- [x] overlay.ts / renderer.ts: 透過キャンバス(実 td を隠さない)にボール・パドル・パーティクル・HUD を描画
- [x] td-paint.ts: ヒットで level を下げ、破壊で level0 色へ。teardown で完全復帰 — 6 tests pass
- [x] content.ts: 「🎮 崩す」ボタン注入、mount/unmount、turbo:load / turbo:before-render 対応(多重初期化なし)— 5 tests pass
- [x] `pnpm -r test`(最終 162/162 pass。レビュー対応前は 145/145)/ `pnpm -r build` exit 0
- [x] 実 github.com/toshi0607 で dist/content.js を注入してエンドツーエンド検証 — 下記「セッション4 検証記録」
- [x] フェーズゲート: reviewer(opus) — **初回は Request changes(H1 が blocker)**。H1/M2/M3/M4 と Low 10件を修正 → 再レビューで Approve(そこで出た Medium 1件・Low 4件も対応)。詳細は Review 欄。拡張のテストは 27 → 44 件
- [x] PR → CI green → API マージ — https://github.com/toshi0607/kusakuzushi/pull/7(CI pass 30s → merge 47fb541)

## 全4セッション完了(2026-07-25)

| Phase | 内容 | 成果物 | 完了条件(DESIGN §7)の充足 |
|-------|------|--------|---------------------------|
| 1 | core + web MVP | `packages/core`, `apps/web` | 自分のユーザー名で最後まで遊べ、共有リンクが機能する ✔ |
| 2 | 動的OGP + 演出 | `workers/ogp` | X/Slack の実クローラー UA でカードプレビューが出る ✔ |
| 3 | Chrome 拡張 | `apps/extension` | 自分のプロフィールで本物の草が崩せる ✔(実 github.com/toshi0607 で実測) |

- 本番: https://kusakuzushi.toshi0607.com(Cloudflare Pages)+ `/share/*` は OGP Worker
- 拡張はストア未申請。`apps/extension/README.md` の手順で unpacked 読み込み
- テスト 162件 / 4パッケージ、CI は `pnpm -r test` + `pnpm -r build`
- `packages/core` はセッション1以降**一度も変更していない**(ゲームバランス不変)。web も拡張も core の同じ `Game`/`toGrid` を、それぞれのアダプタでデータ源だけ差し替えて使っている — DESIGN §1 の唯一の重要な設計判断がそのまま成立した

### セッション4 レビュー後の再検証(2026-07-25 実 github.com/toshi0607 実測)

H1 の修正は「草がまだ DOM に無い状態で content script が動く」という順序でしか効かないため、実ページで順序を再現して確認した。

```
1. 実ページから .js-yearly-contributions ノードを取り外す(= include-fragment 未解決の状態)
2. その状態で dist/content.js を注入   → ボタン0個・テーブル0個(以前はここで永久に諦めていた)
3. 草ノードを後から差し戻す(= fragment 解決) → MutationObserver 経由でボタン1個「🎮 崩す」が出現
4. そのまま発射して 400 フレーム駆動   → 5セル破壊。うち level2 のセルは中間ダメージ(L1 色)で表示され、破壊済みは L0 色
5. turbo:before-cache を発火          → ボタン0・canvas 0・painted 0・style は "width: 10px" に復帰・rAF キュー0
6. pageshow を発火                    → ボタン1個「🎮 崩す」で復活(bfcache 復帰)
```

### セッション4 検証記録(2026-07-25 実 github.com/toshi0607 実測)

ビルド成果物 `apps/extension/dist/content.js`(esbuild の IIFE、13,922 bytes)を実ページに注入して実測。
※ ブラウザペーンは visibilityState=hidden で rAF が止まるため、セッション2 と同じ「rAF をキュー化して同期 drain する」ハーネスで駆動。
今回は id をキーに持つ Map 実装にした(単純な配列だと GitHub 自身の cancelAnimationFrame がゲームループごと巻き添えで消してしまい、ループが静かに死ぬ)。

| 検証項目 | 実測結果 |
|----------|----------|
| ボタン注入 | `#kusakuzushi-launch`「🎮 崩す」が `.js-yearly-contributions` 配下に1個 |
| **幾何の一致** | canvas: left 394.828px / top 676px / 692x194px、内部解像度 1384x388(dpr=2)。実 td の canvas 内座標 (0,0)=(3,3) / (3,10)=(133,42) / (6,52)=(679,81) — core の `computeLayout` の期待値 `3+col*13, 3+row*13` と**完全一致** |
| 透過 | キャンバスの 99.11% が alpha=0。草セル直上 (8,8) も alpha=0 で実 td が透けて見える。パドルは (346,182) に `rgb(36,41,47)` で描画 |
| **破壊演出** | 発射 → 600フレーム駆動で6セル破壊。実 td の背景が `rgb(172,238,187)`(L1)/`rgb(74,194,107)`(L2)から `rgb(239,242,245)`(L0)へ変化 |
| **スコア(L4)** | 3ライフ喪失で結果バナー「ゲームオーバー / Score: 3」。count=level² が効いており 0 点になっていない |
| 原状復帰 | 「やめる」で painted td 0個、style 属性が元の `width: 10px` に完全復帰、canvas 除去、ボタン「🎮 崩す」に戻る |
| もう一回 | バナー除去 → td 復帰(painted 0)→ 新しいゲームが走る(rAF キュー 1) |
| turbo 対応 | `turbo:before-render` でボタン0個・canvas 0個・painted 0個・rAF キュー0(リークなし)。続けて `turbo:load` を3回発火してもボタン1個・canvas 0個(多重初期化なし) |

### 拡張の手動読み込み手順(unpacked)

```bash
pnpm --filter @kusakuzushi/extension build
# → apps/extension/dist が生成される
```

1. Chrome で `chrome://extensions` を開く
2. 右上「デベロッパー モード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」→ `apps/extension/dist` を選択
4. `https://github.com/toshi0607` を開き、草グラフ右上の「🎮 崩す」を押す
5. マウスでパドル移動、クリック/Space で発射。破壊された日の草が実際に灰色になる
6. 「やめる」または他ページへ遷移で原状復帰

## セッション5: Web 版ビジュアルデザイン改善(計画済み・実装未着手)

設計: ../DESIGN-VISUAL.md が正(コンセプト「夜の畑のアーケード」、トークン、タイポ、レイアウト、モーション、コピーの全仕様)。ここは実行計画。

### Constraints(セッション5 追加分)

| Constraint | Source | Verify by |
|------------|--------|-----------|
| ゲームバランス不変(game.ts / physics.ts のロジック・数値に触らない) | 全セッション共通方針 | `git diff main -- packages/core/src/game.ts packages/core/src/physics.ts` が空 |
| core の Theme 変更は optional フィールドのみ(拡張版の後方互換) | DESIGN-VISUAL §5 | 拡張のテスト・ビルドが無変更で pass |
| 緑は草(コンテンツ)専用。UI 操作系はアンバー | DESIGN-VISUAL §0 | style.css に緑系 UI 色がないこと(grep) |
| フレームワーク・JS 依存を増やさない(フォントは Google Fonts のみ) | DESIGN.md §4 / constraints.md | package.json diff |
| ライト/ダーク両対応を維持(prefers-color-scheme) | 現行実装の検証済み挙動 | 両モードのスクリーンショット |
| prefers-reduced-motion 尊重 | DESIGN-VISUAL §4/§9 | エミュレーションで生育アニメ・autopilot 停止を確認 |
| 既存の `.overlay[hidden]` 特異性対策を壊さない | style.css のコメント(実バグ由来) | hidden 時に overlay が消えることを確認 |
| 視覚/スタイリングコードの直接編集は frontend 系ルールに従う | ~/.claude/rules/constraints.md | — |

### Assumptions(セッション5 追加分)

| Assumption | Status | Evidence |
|------------|--------|----------|
| DotGothic16 は Google Fonts で `text=` サブセット取得可(日本語ピクセルフォント) | VERIFIED | 2026-07-25 実測: css2?family=DotGothic16&text=(使用グリフ) → @font-face + unicode-range が返り、woff2 は 3,892 bytes(漢字かな含む全指定グリフが unicode-range に載ることを確認) |
| canvas の `ctx.font` で Web フォント(DotGothic16)が使える(document.fonts.load 後) | VERIFIED | 2026-07-25 本番ページ上で実測: FontFace(subset woff2) load → status=loaded、`ctx.measureText` が sans-serif と異なる幅(136 vs 139.57)を返し、fillText で 966px 描画。フォールバック(sans-serif)でも描画自体は成立 |
| 53x7 グリッドに 3x5 ピクセル文字 11 字(KUSAKUZUSHI = 43 列)が収まる | VERIFIED | 11×(3+1)−1 = 43 ≤ 53、5 ≤ 7(机上計算) |
| 拡張版は core の render() を使っていない(透過レンダラ独自実装) | VERIFIED | Notes 2026-07-25 (S4)。ただし Theme 型は import しているため optional 追加のみ許容 |

### タスク(フェーズ順。各フェーズ末に build + スクリーンショット確認)

- [x] Phase 1 — トークン・タイポ・ページシェル(f5144d4): style.css をトークン体系で書き換え、DotGothic16 subset + Plex 読込、シェル/フォーカスリング
  - 検証済み: `pnpm -r build` exit 0、162 tests pass、light/dark/mobile スクリーンショット目視(2026-07-25)
- [x] Phase 2 — canvas 描画の磨き込み(5f0835a): ブロック角丸 20%、ボール=アンバー、パドル=カプセル、HUD=DotGothic16(hudFont)、ライフ=草セル。回帰テスト 4 件追加
  - 検証済み: core 34 tests pass、extension 44 tests 無変更 pass、プレイ画面スクリーンショット目視
- [x] Phase 3 — アトラクトモード(1cf78ad): demo-grid(グリフ完全性テスト付き、未定義 throw)、autopilot、reveal 生育アニメ、DEMO PLAY、reduced-motion 分岐
  - 検証済み: rAF 同期駆動ハーネスで 900 フレーム駆動(ループ生存・草が刈られる)、フォーム送信→実セッション差し替え、reduced-motion で pendingRaf=0(静的グリッド)、`pnpm -r test` 173 pass
  - グリフ完全性: KUSAKUZUSHI 全 11 文字の期待パターン一致 + 未定義文字 throw をユニットテストで検証(lessons.md 2026-07-25 対応)
- [x] Phase 4 — リザルト/共有画像(85f54b5): 収穫レポートパネル(草セル 18 個バー)、composeResultImage で 1200x630 合成
  - 検証済み: ハーネスで gameOver 到達しリザルト表示(見出し/ラベル/値/バー 18 セル)、合成画像 1200x630 を DOM 描画して目視、X intent ビルダーはテスト既存 pass で不変
- [x] フェーズゲート: reviewer(opus) に DESIGN-VISUAL.md を渡して設計適合レビュー — **Approve**(Critical/High なし、Medium 4 / Low 7)。全 11 件を同セッションで対応(下記「セッション5 レビュー」)。※ /code-review スキルはこのセッションでは PR 番号引数専用だったため reviewer に一本化
- [x] PR → CI green → マージ → Pages デプロイ → 本番スクリーンショット — PR: https://github.com/toshi0607/kusakuzushi/pull/9(CI test pass 36s → API マージ 5d69164)→ `wrangler pages deploy`(760d7039)→ https://kusakuzushi.toshi0607.com/ HTTP 200 + アトラクト画面のスクリーンショット実測(2026-07-25)

### セッション5 レビュー(reviewer/opus, 2026-07-25)

判定: Approve。指摘と対応:

| ID | Sev | 内容 | 対応 |
|----|-----|------|------|
| M1 | Medium | DotGothic16 の text= サブセットに スコア率 が無く、共有画像の見出し行がフォント混在になる | text= に スコア率 を追加 |
| M2 | Medium | 本番セッションに生育アニメ(reveal)が未適用(§4 の明文要件。demo だけ動く逆転) | session.ts に revealStartMs + reduced-motion 分岐を追加し render に {reveal} を渡す。ハーネス実測: 2フレーム時点で左端のみ描画(leftGreens=1235 / rightGreens=0) |
| M3 | Medium | 375px でリザルトパネルが canvas からはみ出す(§9 品質フロア) | overlay に padding+overflow-y:auto、560px 以下で見出し/統計/ボタンを縮小(横並び維持)。実測 overflows=false。§3 も同判断に更新 |
| M4 | Medium | ローディングでステージが1行に潰れレイアウトシフト(§3「レイアウトシフトなし」違反) | buildLoadingView に canvas 同寸(aspect-ratio 2/1)の board-placeholder を導入 |
| L1 | Low | クリア見出しの ! が ASCII でサブセット(全角!)に無い | 全角!に統一 |
| L2 | Low | アトラクト再スタート時に完成グリッドが1フレーム閃く | reveal 計算を restart() の後ろに移動 |
| L3 | Low | デモのライフが§7の「無限」と不一致 | core 無変更の制約を優先し「gameOver でグリッド再生成」を正式仕様に(§7 更新+コードコメント) |
| L4 | Low | 停止中ループ(リザルト/reduced-motion デモ)が OS テーマ切替に追従しない+theme.ts コメント齟齬 | watchTheme を復活させ、terminal state と reduced-motion デモで1フレーム再描画。コメント修正 |
| L5 | Low | .demo-canvas の cursor 上書きがソース順で死んでいる/未使用 demo-area クラス | .game-canvas の後ろへ移動(理由コメント付き)、demo-area 削除 |
| L6 | Low | .harvest-cell-filled の緑が固定値でテーマ非追従 | --grass-strong トークン(core colors[4] の写し、light/dark 反転)に置換 |
| L7 | Low | フォントロードの空 catch(constraints.md 違反) | 意図的無視である旨のコメントを付与 |

## セッション6: 発射ガイドの重なり修正(完了 2026-07-25)

- [x] ガイド「クリック / Space で発射」が草の最下行に重なる問題を修正 — 草は盤面上半分(core `computeLayout` の `brickAreaHeight = canvasHeight/2 - gap`)を占めるのに対しオーバーレイが盤面全体の中央寄せだったため。`.guide-overlay { top: 50% }` で下半分(パドル空間)の中央へ。DESIGN-VISUAL §3 に配置ルールを明文化
  - 検証(実測): 1280px で草下端との間隔 31px / パドルとの間隔 19px、375px で 30px / 18px。light・dark 両テーマでスクリーンショット確認
- [x] PR → CI green → マージ → デプロイ → 本番確認 — https://github.com/toshi0607/kusakuzushi/pull/11(CI pass 32s → merge 55741e3)、`wrangler pages deploy`(d6a5e170)、本番 https://kusakuzushi.toshi0607.com/?user=toshi0607 で間隔 31px / 19px を実測

## セッション7: 残機表示の可読性修正(完了 2026-07-25)

ユーザー指摘「右上の濃い部分残機ですか？みえづらすぎる」。原因は 2 つ重なっていた:

1. 残機を草スケールの level4(=コンテンツの色)で描いていた — DESIGN-VISUAL §0「緑は草専用」を HUD だけ破っていた
2. HUD を草グリッドの**上に重ねて**いたため背景が常に緑だった(ついでにブロックも隠していた)

- [x] HUD 全体を草の直下(`canvasHeight/2 + 10`)の無地帯へ移動。残機は `--marquee` アンバーの「予備のボール」(実ボールと同色・同径)+ `LIFE` ラベル。DESIGN-VISUAL §5 に HUD 位置の行を追加
  - 検証: core 37 tests pass(HUD 行の円の個数/色/半径、ラベル、`hud:false` の非表示を回帰テスト化)、light/dark 実測、1 機喪失時に ●● へ減りラベルが再整列することも実測
- [x] PR → CI green → マージ → デプロイ → 本番確認 — https://github.com/toshi0607/kusakuzushi/pull/13(CI pass 38s → merge f626b05)、`wrangler pages deploy`(2d37dcd1)、本番スクリーンショットで `SCORE 0` / `LIFE ●●●` を確認
- 拡張版(apps/extension)は元から HUD をパドル半分(草が絶対に来ない領域)に置いており同じ問題はない — renderer.ts:112 のコメントで確認済み。対応不要

## セッション8: トップページの OGP 画像(完了 2026-07-25)

### 症状と原因(2026-07-25 実測)

ユーザー報告: Slack に `https://kusakuzushi.toshi0607.com` を貼ってもカード画像が出ない。

- 原因: **トップページ(Pages が返す `apps/web/index.html`)に OGP タグが1つも無い**。Slack が出していたのは `<title>`(草崩し)と `<meta name="description">` だけ。X でも同様に画像は出ない
- `/share/{user}` は無関係(正常)。Slackbot の UA `Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)` は `crawler.ts` の `"bot"` に一致し、curl 実測でも OGP HTML(og:image + twitter:card)が返り、`og.png` は 200 / image/png / 48,932 bytes

### Constraints(セッション8)

| Constraint | Source | Verify by |
|------------|--------|-----------|
| 新しい依存を増やさない(OGP 画像生成に puppeteer 等を入れない) | DESIGN.md §4 / constraints.md | package.json diff が空 |
| 共有画像は閲覧者テーマに関係なく常に「夜の畑」(ダーク固定) | share.ts の SHARE_COLORS コメント(ブランド判断) | 生成画像の背景が `#0c110d` |
| ワードマークは demo-grid の実グリフを使う(独自に描き直さない) | lessons.md 2026-07-25(黙った代替グリフ事故) | 生成コードが `buildDemoGrid()` を import している |
| 生成物(PNG)は再現手順ごとコミットする | unknowns.md 1.3(参照可能であること) | tools/ にジェネレータが存在し手順がヘッダにある |
| ゲームバランス・core を変更しない | 全セッション共通 | `git diff main -- packages/core` が空 |

### Assumptions(セッション8)

| Assumption | Status | Evidence |
|------------|--------|----------|
| トップの OGP 欠落が Slack で画像が出ない原因(share は正常) | VERIFIED | 2026-07-25 curl 実測(上記「症状と原因」) |
| Slackbot は `crawler.ts` の `"bot"` 部分一致で既にクローラー判定される | VERIFIED | 同上(Slackbot UA で /share/ が OGP HTML を返す) |
| `apps/web/public/` は Vite が dist へコピーし `/og.png` で配信される | VERIFIED | 2026-07-25 `pnpm -r build` 後 `apps/web/dist/og.png`(1200x630, 68,138 bytes)が存在。dev でも `HEAD /og.png` → 200 image/png |
| Vite dev は `tools/*.html` を任意ページとして配信でき、既定ビルド入力は index.html のみ(tools がバンドルに混ざらない) | VERIFIED | 2026-07-25 dev で `/tools/og-card.html` が描画。build 後 `find dist -name "*og-card*"` が空、JS ハッシュも本番と同一(index-CWyvfmJ6.js) |

### タスク

- [x] `apps/web/tools/og-card.{html,ts}` + `og-card-main.ts` — 1200x630 のトップ用カードを canvas で合成するジェネレータ。`buildDemoGrid()` + core `render()` + share.ts / theme.ts のトークンを再利用し、attract 画面と同じ盤面を描く
  - 盤面(2:1)は草の下に約 190px の空白帯があるので、単色の帯だけを切り落として上下 2 スライスを詰めて描く。境界は core の `computeLayout` から導出
  - `SHARE_COLORS` / `DISPLAY_FONT` / `BODY_FONT`(share.ts)と `WEB_DARK_THEME`(theme.ts)を export して再利用 — カード側で色やフォントを再定義しない
- [x] `apps/web/vite.config.ts` — dev 専用エンドポイント `/__save-og-card` を追加し、ボタン押下で `public/og.png` を直接上書き(ブラウザのダウンロードは preview ペーン・実 Chrome とも保存されなかったため)
- [x] 生成した PNG を `apps/web/public/og.png` としてコミット — 1200x630 / 68,138 bytes。フルサイズで目視確認(DotGothic16 のドット字形が出ていること、ワードマークが KUSAKUZUSHI で崩れていないこと)
- [x] `apps/web/index.html` に OGP/Twitter メタを追加(og:type/site_name/locale/title/description/url/image/image:type/width/height/alt、twitter:card/title/description/image、canonical)
  - 実測: dev の DOM から 14 タグすべてを確認、`HEAD /og.png` → 200 image/png、アトラクト canvas も従来どおり描画、console エラー 0
- [x] `workers/ogp` の share ページにも og:image:type/width/height と og:locale を追加(Slack/Facebook の large card 判定を確実にする)+ 回帰テスト 1 件
- [x] `pnpm -r test`(174 tests / 4 パッケージ)/ `pnpm -r build` exit 0
- [x] PR → CI green → マージ → Pages + Worker デプロイ → 本番 curl でメタ確認 — https://github.com/toshi0607/kusakuzushi/pull/15(CI pass 38s → merge d0787fd)、`wrangler pages deploy`(59aa94b0)、`wrangler deploy`(worker version 5d018091)
  - 本番実測(2026-07-25): `/` は素の curl・Slackbot UA とも同一 3,413 bytes で og:type/site_name/locale/title/description/url/image(+type/width/height/alt)/twitter:card/canonical を返す。`/og.png` は 200 image/png 68,138 bytes(コミットした PNG とサイズ一致)。`/share/{user}` も og:image:type/width/height + og:locale を返す
  - 未実施: Slack への実貼り確認はユーザー側。**Slack はアンフォールを URL 単位でキャッシュするので、以前貼った URL は同じカードのままになることがある**(新しいクエリ付き URL を貼るか時間を置く)

### セッション8 の設計判断メモ

- **トップは静的 PNG、share は Worker 動的**という役割分担にした。トップ URL は最も貼られるので、表示のたびに satori + Google Fonts に依存させたくない(それらが落ちてもカードは出る)。share カードはスコア依存なので動的でしか作れない
- 途中で作った盤面の「空白帯カット」は、盤面 2:1 の下半分がほぼ無地であることに依存している。core の `computeLayout` が変わっても追従するよう境界値はそこから導出済み
- ブラウザのダウンロードは preview ペーン・実 Chrome とも保存されなかったため、dev 専用エンドポイント(vite.config.ts)で `public/og.png` を直接書く方式にした。結果として再生成手順が「開いてボタンを押す」だけになった

## セッション9: ブロック破壊時のアイテムドロップ(実装中)

ユーザー要望(2026-07-25): 「たまにブロックを崩したときにアイテムが降ってくるようにしてください」
- 玉の数が増える
- バーの数が一時的に増える

バー増加の挙動は **メインパドルの左右に追加バーが1本ずつ出て3本が一緒に動く**(ユーザー選択 2026-07-25)。

### Constraints(セッション9)

| Constraint | Source | Verify by |
|------------|--------|-----------|
| **今回に限りゲームバランス変更は許可**(過去セッションの「バランス不変」制約はユーザー要望で上書き) | ユーザー指示 2026-07-25 | この行の存在 |
| core は DOM/fetch 非依存を維持 | DESIGN.md §1 | core/src に document/fetch/performance 参照がないこと(grep) |
| 乱数はテストから差し替え可能にする(決定的テスト) | ~/.claude/rules/testing.md | ユニットテストが Math.random に依存しないこと |
| 既存の公開 API を壊さない(`ballState` / `paddleState` は残す) | 拡張・web・attract が参照(grep 実測) | 既存テストが無改変で pass(BASE_CONFIG の型追随を除く) |
| 拡張の透過レンダラにも玉/バー/アイテムを反映(core だけ変えると不可視の玉ができる) | DESIGN §5 の核 | 拡張のレンダラテスト |
| Theme の変更は optional フィールドのみ | DESIGN-VISUAL §5 / セッション5 制約 | 拡張が Theme 型を無改変で使えること |
| 緑は草専用・UI/アイテムはアンバー系 | DESIGN-VISUAL §0 | renderer のアイテム色が accentColor 由来 |
| 追加バーの隙間 < ボール直径(すり抜け防止) | 物理的要請 | gap = ballRadius(直径の半分)固定 + ユニットテスト |

### Assumptions(セッション9)

| Assumption | Status | Evidence |
|------------|--------|----------|
| `GameConfig` は core のテストで完全なリテラルとして書かれており、必須フィールド追加で型エラーになる | VERIFIED | packages/core/src/game.test.ts:32-44(BASE_CONFIG) |
| 拡張は `{...DEFAULT_CONFIG, ...deriveConfig(geometry)}` で config を作るのでフィールド追加は自動で埋まる | VERIFIED | apps/extension/src/content.ts:124 |
| 拡張は core の `render()` を使わず独自の透過レンダラを持つ | VERIFIED | apps/extension/src/renderer.ts 冒頭コメント + Notes 2026-07-25 (S4) |
| `ballState` / `paddleState` の参照箇所は core renderer / 拡張 renderer / attract の autopilot のみ | VERIFIED | grep 実測(2026-07-25): renderer.ts:196,200 / extension renderer.ts:99,105 / attract.ts:79 |
| 拡張の盤面は 692x194 と小さく、アイテムサイズ/落下速度は deriveConfig で縮める必要がある | VERIFIED | adapter.ts の canvasHeight=2*(7*10+9*3)=194 実測(セッション4「幾何の解」) |

### 仕様(実装値)

| 項目 | 値 | 置き場所 |
|------|-----|---------|
| ドロップ確率 | **序盤 22% → 終盤 8%**(破壊済み割合で線形補間) | `itemDropChance` + `earlyItemDropBonus` |
| 種類の抽選 | 50/50 | `Game.maybeDropItem` |
| 落下速度 / サイズ | 120 px/s / 14px 角(拡張版は盤面に合わせ 10px・48.5px/s) | config + `deriveConfig` |
| 玉増加 | **飛んでいる玉を全部2倍に分裂**(±22° の扇)。取るたび複利で 1→2→4→8…、上限200個 | `multiBallSplitFactor` / `maxBalls` |
| アイテムの色 | 青(light `#0969da` / dark `#58a6ff`)。玉のアンバー・草の緑と別 | `Theme.itemColor` / `OverlayTheme.itemColor` |
| バー増加 | 左右に幅50%のバー、12秒。隙間 = ボール半径(直径の半分 → すり抜け不可) | `extraPaddleDurationSec` / `extraPaddleWidthRatio` |
| ライフ | 玉が全部落ちて初めて1減。落球で落下アイテムと追加バーはリセット | `Game.handleBallLost` |

### タスク

- [x] core: `items.ts`(Item 型 + 純関数: 落下・矩形化・キャッチ判定)
- [x] core: `game.ts` を複数ボール/複数パドル/アイテム対応に(config 追加、`ballStates`/`paddleStates`/`itemStates`、`onItemCollected`)
- [x] core: `renderer.ts` で全ボール・全バー・アイテムを描画(アイテムは種類が見た目で判る)
- [x] core: ユニットテスト(ドロップ有無・multiBall・extraPaddle 期限切れ・全球ロストで初めてライフ減・すり抜け防止・落球リセット)— core 36 → 46 tests
- [x] extension: 透過レンダラを複数ボール/複数バー/アイテム対応に + deriveConfig でアイテム寸法をスケール — `renderer.test.ts` 新設(3件)+ adapter に寸法テスト。拡張 44 → 48 tests
- [x] web: attract の autopilot を「一番下のボール」追従に
- [x] `pnpm -r test`(187 pass: core 46 / ogp 65 / web 28 / extension 48)/ `pnpm -r build` exit 0
- [x] ブラウザ実機でアイテム取得までプレイ検証 — 下記「セッション9 検証記録」
- [x] DESIGN.md §3 / DESIGN-VISUAL §5 にアイテム仕様を追記
- [x] 自己レビュー(このセッションはサブエージェント禁止の実行環境のため reviewer エージェントは使わず、差分の通読で代替)。見つけた点: クリア時に落下中アイテムが結果画面へ凍りついたまま残る → `clear` 遷移時に `items` を空にする修正を入れた
- [x] ユーザー指摘の調整(2026-07-25): アイテムを青に / 玉を「めちゃくちゃ多く」増やせるように — 下記「調整の記録」
- [ ] PR → CI green → マージ(ユーザー確認後)

### 調整の記録(ユーザー指摘 2026-07-25)

指摘: 「アイテムの色を青とか別の色に」「玉の数はめちゃくちゃ多くまで増やせる(草が多いとぜんぜん終わりに到達できない)」

1. **色**: `Theme.itemColor` を light `#0969da` / dark `#58a6ff` で埋め、拡張の `OverlayTheme` にも `itemColor` を追加。玉のアンバーと同色だと「追う物」と「ただの玉」が見分けにくかったため
2. **玉の増え方**: `multiBallSpawnCount`(固定+2)を **`multiBallSplitFactor`(飛んでいる玉を全部 N 倍)** に置き換え、`maxBalls` 5 → 200。固定加算では取っても線形にしか増えず、371 ブロックの盤面では刈り切れないという指摘そのものが直らないため、複利で増える形にした
3. **上限200の根拠(実測)**: 371 ブロック盤面での `update()` は 1玉 0.02ms / 25玉 0.29ms / 121玉 0.49ms(16.7ms 予算)。ブラウザ実測でも 191〜196 玉で `update` 0.35〜0.39ms・`render` 0.6〜2.4ms。上限はバランス調整用ではなく暴走時のバックストップ
4. **実測(ブラウザ)**: ドロップ率100%の一時ページで玉が 1→2→4→8→16→191→196(上限)と複利で増え、**371ブロックの盤面が `clear` に到達**(スコア 3,717)。青タイルは light/dark 両方でスクリーンショット目視確認(アンバーの玉と明確に別物に見える)
5. **序盤の加速**(ユーザー指摘「初期もう少し加速できますか」2026-07-25): ドロップ確率を固定 8% から **序盤 22% → 終盤 8% の線形ランプ**に(`earlyItemDropBonus = 0.14`、破壊済み割合で補間)。立ち上がりは玉1個で手が足りず、そこを厚くしないと複利が始まらないため。終盤は玉が増えているので絞る。ユニットテストは「同じ乱数値が序盤は通り終盤は弾かれる」形で検証(フラット確率に戻すと落ちる)。371ブロック盤面の 180 秒シミュレーション(完璧オートパイロット、3シード)では flat 8% が 3回とも 6ブロックだったのに対し、ランプありは 1回が 21ブロック(アイテムを拾って複利が始まった回)

### セッション9 検証記録(2026-07-25 実ブラウザ実測)

`itemDropChance: 1` に固定した一時ページ(`apps/web/item-check.html`、検証後に削除)を Vite dev で開き、core の `Game` + `render()` を同期駆動して実測。

| 検証項目 | 実測結果 |
|----------|----------|
| ドロップ | 120フレームで `items: ["multiBall"]` が出現(ブロック中心から落下) |
| 玉増加 | 取得で `balls: 1 → 3`、以降も取り続けて `balls: 5` で頭打ち(`maxBalls`) |
| バー増加 | 取得で `bars: 1 → 3`。座標実測 main `x=350 w=80` / 左 `x=304 w=40` / 右 `x=436 w=40`、全て `y=444` — 隙間はちょうどボール半径 6px |
| 効果時間 | 取得直後 `extraPaddleRemaining = 11.98`(12秒から減衰) |
| 描画 | スクリーンショット目視: アンバーのタイルに「3本バー」「3点」の記号、玉3個とバー3本が同時に描画される |
| 実アプリ | `/` から `@toshi0607`(3,012 contributions)でセッション開始 → rAF ハーネスで 1200 フレーム駆動してループ生存・盤面描画を確認 |

## Notes

- 2026-07-24: gh のデフォルトホストが github.gatech.edu のため、github.com 操作は GH_HOST=github.com を明示する
- 2026-07-25: CI で web テストが「Failed to resolve entry for package @kusakuzushi/core」で fail(CI は core の dist 未ビルド、ローカルは過去ビルドの stale dist で偶然通っていた)。内部専用パッケージのため core の exports を src/index.ts 直指しに変更して解消。moduleResolution: bundler なので tsc/Vite とも src 直参照で問題ない
- 2026-07-25 (S3): workers-og@0.0.27 の `loadGoogleFont` は `text` パラメータを URL エンコードせず css2 URL に埋め込むため、サブセット文字列に生の `%` があると不正なパーセントエスケープになり、Google が日本語グリフ抜きのフォントを返す(cmap 実測: 正エンコード 79 グリフ/生 67 グリフ・日本語なし)。workers/ogp/src/fonts.ts で encodeURIComponent する自前ローダーに置き換えて解消
- 2026-07-25 (S3): satori(workers-og の HTMLRewriter パーサ)は `&nbsp;` 等の HTML 実体参照を解釈せずリテラル文字列として描画する。スペーシングは margin で行うこと
- 2026-07-25 (S4): **拡張のビルド方式は素の esbuild を採用**(DESIGN §6 で「Phase 3 で決定」とされていた項目)。理由: エントリは content script 1本のみで popup/background なし、HMR も不要。CRXJS(@crxjs/vite-plugin、2.7.1 / 2026-07-01 リリース、Vite 3-8 対応で活発にメンテ中)の価値は MV3 の複数エントリ管理と content script の HMR にあり、今回はそのどちらも使わない。しかも CRXJS の未解決 issue は HMR 周りに集中している(#898/#1021/#671/#897)。一方 esbuild は `@kusakuzushi/core` の `exports: {".": "./src/index.ts"}`(TS ソース直公開)を追加プラグインなしで解決でき、ビルドは build.mjs 30行で済む。popup 追加や複数エントリが必要になったら CRXJS へ移行する
- 2026-07-25 (S4): **core の `render()` は拡張では使えない**。キャンバス全面を `theme.colors[0]` で不透明に塗り、さらにブロック自体も描くため、実 td が隠れて DESIGN §5 の核(本物の草が減って見える)が成立しない。拡張は `apps/extension/src/renderer.ts` に透過レンダラ(clearRect のみ、ボール・パドル・パーティクル・HUD だけ描画)を持ち、ブロックの見た目は実 td そのものが担う
- 2026-07-25 (S4): オーバーレイは DESIGN §5 の `position: fixed` ではなく `absolute` + page 座標にした。fixed だとページスクロールした瞬間に草からズレる。逸脱の理由は overlay.ts にコメントで残してある
- 2026-07-25 (S4): 草 td には contribution 数そのものは無いが、`aria-labelledby` が指す tooltip 要素には「N contributions on ...」というテキストがある。今回は申し送りどおり count=level² を採用(決定的で DOM 依存が少ない)。将来スコアの精度を上げたければ tooltip 経由で実数を取る余地がある
- 2026-07-25 (S4): 実ページ検証用の rAF ハーネスは **id をキーにした Map** で実装すること。単純な配列キューにして `cancelAnimationFrame` で全消しすると、GitHub 自身のコードが自分の rAF をキャンセルした瞬間にゲームループまで消えて「原因不明でループが止まる」現象になる(実際に1回踏んだ)
- 2026-07-25 (S6): デプロイ後の本番確認で画面が真っ白になり production 障害に見えたが、**原因はブラウザペーン側の HTTP キャッシュに残った切り詰めレスポンス**だった(ネットワークログに `net::ERR_CONNECTION_CLOSED` あり)。判別方法: ページ内で `fetch(url)` と `fetch(url, {cache:"reload"})` の長さを比較 — キャッシュ 1,535 文字 / 実体 21,622 文字で確定した。origin 側は curl で dist と byte 一致、同一成果物が pages.dev と localhost では正常描画。切り詰めた JS はパースが通ってしまうと **console エラーを出さずに何もしない**ため「JS が実行されていない」ようにしか見えない。真っ白のときは (1) curl で HTML/JS を dist と shasum 比較、(2) pages.dev で同一成果物を確認、(3) ページ内 fetch のキャッシュ有無比較、の順で切り分ける
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

### セッション4 フェーズゲート(reviewer/opus, 2026-07-25)

判定: **初回 Request changes → 全件対応済み**。検証: pnpm -r test 162/162 pass(拡張は 27 → 44 件)、pnpm -r build exit 0、`git diff main...HEAD -- packages/core` 0行、セレクタ隔離・count=level² のテスト担保を確認。

| ID | Sev | 内容 | 対応 |
|----|-----|------|------|
| H1 | High | **GitHub は草グラフを `<include-fragment>` で後から流し込む**(プロフィールの初期 HTML に `ContributionCalendar` は0個 — curl で実測)。content script は `document_idle` で1回試すだけだったので、実ページでは「🎮 崩す」が永久に出ない。turbo:load も fragment 解決より先に発火するため同様。私の初回実ページ検証が「読み込み済みページへの注入」だったためこの競合を隠していた | 修正: `autoMount` を追加し、mount 失敗時は MutationObserver で草の出現を待つ。エントリを `src/main.ts` に分離(content.ts を副作用なしに)。実ページで順序を再現して検証済み(上記「再検証」) |
| M2 | Medium | `paddleX` が未クランプ。mousemove は window に張っているので広い画面では常に盤外の値になり、←→ キーが数十回効かない | 修正: `setPaddleX` で `[0, canvasWidth]` にクランプ(apps/web/src/session.ts と同じ対処) |
| M3 | Medium | Turbo は `turbo:before-cache` でスナップショットを取るのに、片付けが `turbo:before-render` だった。戻るボタンで灰色の草と孤児 canvas が復元され得る。再利用したボタンのラベルも「やめる」のままだった | 修正: `turbo:before-cache` を追加、ボタン再利用時に必ずラベルを初期化。実ページで検証済み |
| M4 | Medium | `createGameRuntime` のテストがゼロ(jsdom に 2D コンテキストが無く、全テストがゲーム開始前で止まっていた)。最重要の row/col → date → td の写像が未検証 | 修正: `game-runtime.test.ts` を追加。canvas ctx / rect / rAF をスタブして実際にゲームを走らせ、破壊された日の td だけが塗られること・teardown の完全性(canvas 除去、rAF キャンセル、style 完全復帰、リスナ解除)を検証 |
| L1 | Low | keydown が window 直付けで、GitHub の検索欄に打った Space を飲み込む | 修正(input/textarea/select/contenteditable では素通し) |
| L2 | Low | 結果バナーが白固定で、ダークテーマだと文字が読めない | 修正(ページの実際の色を採用。L3 と同時対応) |
| L3 | Low | パドル/ボールの色が OS の prefers-color-scheme 依存で、GitHub 側のテーマ設定と食い違う | 修正: `readPageColors` で body の computed color/background を採用 |
| L4 | Low | bfcache 復帰時、pagehide でボタンを消したきり戻らない | 修正(`pageshow` で再マウント) |
| L5 | Low | `geometry.cols` と `grid.weeks.length` の食い違いが起きても無言でズレる | 修正(不一致時に console.warn) |
| L6 | Low | `typeof document` ガードは vitest では効かない(jsdom にも document がある) | 修正: エントリを `src/main.ts` に分離してガード自体を廃止 |
| L7 | Low | ブロックの y 座標の整合テストが無い(y こそ canvasHeight の導出に依存) | 修正(`brick.rect.y === 3 + row*13` を追加) |
| L8 | Low | `readLevelColors` にテストが無い(1レベルでも欠けると全体フォールバックする all-or-nothing 挙動) | 修正(正常系と level4 欠落時の null を追加) |
| L9 | Low | CI が `pnpm -r test` のみで、型チェック(build の tsc)を回していない | 修正(ci.yml に `pnpm -r build` を追加) |
| L10 | Low | フィクスチャに実ページ由来の `data-hydro-click-hmac` が残っている(資格情報ではないが不要) | 修正(hmac/nonce を scrubbed に置換。371セルは維持) |

#### 再レビュー(同日、修正差分 dc6ec2f に対して)

判定: **Approve**(Critical/High なし。前回13件はすべて解消を確認)。追加で出た指摘も全件対応:

| ID | Sev | 内容 | 対応 |
|----|-----|------|------|
| R-M1 | Medium | ボタンの置き場所 `.js-yearly-contributions` は include-fragment の**レスポンスのルート要素そのもの**。fragment が差し替わるとボタンごと消えるが、mount 成功後に observer を切っていたため二度と復帰しない(Turbo イベントも飛ばない) | 修正: observer をページ寿命の間張り続け、`isMounted()` が false のときだけ張り直す。**さらに実ページ検証で判定の弱さを発見** — id で探すと「スナップショットに含まれるボタンの複製」を生きていると誤認するため、セッションが持つ要素の同一性(`activeButton.isConnected`)で判定するよう変更。修正前に落ちる回帰テスト2件を追加 |
| R-L1 | Low | teardown テストの rAF キャンセル検証が空虚(ラウンド終了後に停止しており、キュー0を stop 前に確認していた) | 修正(ゲーム中の teardown で `pendingCount` が 1 → 0 になることを検証) |
| R-L2 | Low | content script は github.com 全体にマッチするので、リポジトリ/PR ページでも observer が張りっぱなしになる | 修正(パスが1セグメント = プロフィール形式のときだけ張る) |
| R-L3 | Low | 既存ボタンを再利用すると前のセッションのクリックハンドラが残り、1クリックで2ゲーム起動し得る | 修正(再利用せず作り直す)+ 回帰テスト |
| R-L4 | Low | M2(クランプ)と L1(入力欄)にテストが無い | 修正(パドル位置をスタブ ctx の fillRect から読む形で検証)。**この過程でクランプ範囲の誤りを発見** — カーソルを `[0, canvasWidth]` ではなくパドル中心の可動域 `[w/2, canvasWidth-w/2]` に合わせないと、狭い盤面で最初の1〜2回の矢印入力が飲まれる |
| R-L5 | Low | リファクタで置き去りになったコメント・README・todo.md の件数 | 修正 |
