# kusakuzushi 実装プラン

設計: ../DESIGN.md(リポジトリルートの DESIGN.md)が正。ここは実行計画。

## Constraints

| Constraint | Source | Verify by |
|------------|--------|-----------|
| core は DOM/fetch 非依存の純粋 TS | DESIGN.md §1 | core/src に fetch/document 参照がないこと(grep) |
| データ源はアダプタで差し替え可能 | DESIGN.md §2 | core が ContributionGrid 型のみに依存 |
| リポジトリは private で作成。**将来 public にする**(時期は未定) | セッション1判断 + ユーザー方針 2026-07-26 | gh repo view。公開耐性のある CI 構成はセッション14 で用意済み |
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

## セッションの索引

並行セッションが同じ番号を取ってしまい、**8 と 10 が 2 回ずつ**使われている(13 も一度衝突したが、こちらは相互参照が増える前に片方を 14 へ振り直した)(番号での相互参照が本文・`lessons.md` に多数あるため、振り直さず索引で引けるようにする)。ファイル内の並び順も時系列とは一致しない。

| 番号 | 主題 | 状態 |
|---|---|---|
| 1 | リポジトリ + core エンジン | 完了 |
| 2 | Web アプリ MVP | 完了 |
| 3 | OGP Worker + 演出 | 完了 |
| 4 | Chrome 拡張 | 完了 |
| 5 | Web 版ビジュアルデザイン改善 | 完了 |
| 6 | 発射ガイドの重なり修正 | 完了 |
| 7 | 残機表示の可読性修正 | 完了 |
| 8(1つ目) | モバイル操作 — 盤面下のパドルレール | 完了(実機確認はユーザーが 2026-07-26 に実施) |
| 8(2つ目) | トップページの OGP 画像 | 完了 |
| 9 | Lighthouse によるパフォーマンス改善 + 継続計測 | 完了 |
| 10(1つ目) | ブロック破壊時のアイテムドロップ | 完了 |
| 10(2つ目) | ファビコン | 完了 |
| 11 | ブロックを正方形にする(草グラフ実寸比) | 完了 |
| 12 | 本番だけ Lighthouse が赤い件 | 完了(本番 green を実測) |
| 13 | Chrome ウェブストア公開 | 進行中 |
| 14 | PR マージで自動デプロイ + パブリック化の準備 | 進行中 |

セッション12 までは**未完了なし**(2026-07-26 時点)。最後まで残っていたセッション8 の実機確認はユーザーが実施して OK。

**デプロイの現行手順はセッション14 を見ること。** それ以前のセッションの引き継ぎに書いてある
`npx wrangler pages deploy ...` はもう手順ではない(main へのマージで自動デプロイされる)。

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

## セッション4: Chrome 拡張(完了 2026-07-25)

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

## セッション5: Web 版ビジュアルデザイン改善(完了 2026-07-25)

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
## セッション8: モバイル操作 — 盤面下のパドルレール(完了 2026-07-25 / 実機確認 2026-07-26)

ユーザー指摘(2026-07-25): 「スマホだと全然できないので、描画領域下で触れる形でもバーを左右に動かせるようにしてください」

問題の実体: パドル操作は canvas 上の `pointermove` だけ。タッチでは (1) 指を高さ ~170px の盤面に置くのでボールとパドルが指の下に隠れる、(2) `pointerdown` が即 `launch()` なので狙いを定める前に発射される、(3) 指を離すと追従が切れる。結果、スマホでは実質操作不能。

解: 盤面の**すぐ下**に、パドルの可動域を 1:1 で写した専用のタッチレールを置く。レール幅 = canvas の CSS 幅なので、指の x はそのまま「真下にパドルが来る」絶対マッピングになる。押している間は移動だけ、**指を離した瞬間に発射**(狙ってから撃てる)。

### Constraints(セッション8 追加分)

| Constraint | Source | Verify by |
|------------|--------|-----------|
| ゲームバランス(core)は変えない | セッション3以降の継続制約 | `git diff main...HEAD -- packages/core` が0行 |
| 緑はコンテンツ(草)専用。UI 操作系はアンバー | DESIGN-VISUAL §1 | レールのハンドルは `--marquee` |
| canvas 内部解像度 960x480 は不変 | DESIGN-VISUAL §3 | canvas.width/height 無変更 |
| デスクトップの見え方は変えない | 最小差分 | `@media (pointer: coarse)` でのみ表示 |
| 装飾はシグネチャー(アトラクト)以外に足さない | DESIGN-VISUAL §0 | レールは canvas と同じ枠(`--ridge` 1px / 角丸 8px)だけ |

### Assumptions(セッション8 追加分)

| Assumption | Status | Evidence |
|------------|--------|----------|
| レール幅と canvas の CSS 幅が一致する(比例変換で指の真下にパドルが来る) | VERIFIED | 同一 `.play-stack`(flex column)の直下で両方 `width: 100%` — 実測で確認(下記検証記録) |
| jsdom 25 に `PointerEvent` / `setPointerCapture` は無い | VERIFIED | 2026-07-25 実測(`typeof PointerEvent === "undefined"`、`setPointerCapture is not a function`)。→ ドラッグ追従は暗黙のポインタキャプチャに頼らず window リスナで実装し、テストは `MouseEvent("pointerdown")` で駆動する |
| `(pointer: coarse)` が「主入力がタッチ」の判定として妥当 | VERIFIED(ただし当初の但し書きは誤り) | Baseline(Media Queries L4)。**`pointer` は*主*入力しか見ない**ので、タッチスクリーン付きノート PC は `pointer: fine` + `any-pointer: coarse` になりレールは出ない。当初「ハイブリッド機ではレールが出るので実害なし」と書いていたが逆で、再レビュー H-A の指摘どおり「レールも無い・盤面もタッチを拒む」死に状態を作っていた。対応: 盤面のタッチ譲渡はレール自身の可視性(幅 > 0)で判定し、レールが出ない端末では従来どおり盤面追従にフォールバックする |

### タスク

- [x] `apps/web/src/paddle-rail.ts`: レールの生成・ポインタ処理・ハンドル位置反映(DOM 依存を1ファイルに閉じる)
- [x] `apps/web/src/session.ts`: `.play-stack` でレールを盤面の下に組み込み、rAF ループでハンドルを**実パドル位置**(`game.paddleState`)に追従。ラウンド終了時に `setActive(false)`
- [x] `apps/web/src/style.css`: `.play-stack` / `.paddle-rail` / ハンドル / ヒント / 無効化スタイル
- [x] タッチ端末では発射ガイドの文言を「下のバーで発射」に(クリックも Space も無い操作を案内しない。当初は「タップで発射」だったが、レビュー M1 で盤面のタップ発射をやめたため実際に効く面を指す文言へ)
- [x] `apps/web` に jsdom を追加(環境指定は新規テストの docblock `@vitest-environment jsdom` のみ。既存3ファイルの実行環境は node のまま=無変更)し `paddle-rail.test.ts` 18件 + `session.test.ts` 7件
- [x] `pnpm -r test` 199/199 pass(web 53件)/ `pnpm -r build` exit 0
- [x] テストが実際に回帰を捕まえることをミューテーションで確認(6種): `if (!active) return;` 削除→1件 fail、発射を pointerup→pointerdown→4件 fail、pointerId 比較の削除→2件 fail、`lostpointercapture` リスナ削除→1件 fail、`railOwnsTouch` から可視判定を削除→1件 fail、盤面のタッチ無視を削除→1件 fail、キーボードのクランプを `[0,W]` に戻す→1件 fail
- [x] 実機相当の検証でパドルが指の x に一致することを実測(下記「検証記録」)
- [x] DESIGN-VISUAL.md §3 にタッチ操作の節を追加
- [x] フェーズゲート: reviewer(opus) — 初回 Request changes(High 1 / Medium 3 / Low 7)→ 全件対応済み。詳細は Review 欄
- [x] main を取り込み(セッション7 の 2 コミット)、tasks/todo.md の衝突を解消
- [x] PR → CI green → マージ → デプロイ — https://github.com/toshi0607/kusakuzushi/pull/20(main が 24 コミット進んでいたためマージして衝突解消 → CI test pass 39s / Lighthouse dist pass 1m21s → `gh api -X PUT .../merge` で 0977dfc)、`wrangler pages deploy`(a5f7dec0)
  - 本番確認(2026-07-25 実測): `https://kusakuzushi.toshi0607.com/assets/index-pr2ZC311.js` と `index-Cu7t7aJQ.css` が dist と shasum 一致。CSS に `@media (pointer: coarse)` の `paddle-rail{display:block}`、JS に「下のバーで発射」「触れた位置にパドルが動き、離すと発射」が入っていることを確認。デスクトップ UA では `paddle-rail` の computed display が `none`、ガイドは「クリック / Space で発射」= デスクトップ無変更も実測
  - ※デプロイ直後の1回目の curl は両アセットとも 5,476 バイトの別物が返った(数十秒後には正しい 28,152 バイトを返し shasum も一致)。セッション6 の切り分け手順どおり shasum 比較で判定すること
- [x] main 取り込み時の確認 — 盤面が 960x480 → 960x360(正方ブロック化)になった影響でレールの説明文の高さ表記を更新。パドル幅 80 は不変なのでハンドル比率 8.33% も不変。アイテム「バーが増える」は `paddle.width` を変えず左右に別バーを生やす実装(items.ts / game.ts:450)なのでハンドル寸法にも影響しない。マージ後に実ブラウザで再実測(canvas 960x360 → CSS 343x130、レール幅一致、8px 間隔、レール 25% → パドル 239.5、盤面タッチ無視、離すと発射)
- [x] 実機(スマホ)で本番確認 — **ユーザーが実機で確認して OK(2026-07-26)**。`@media (pointer: coarse)` はエージェント側にタッチ環境が無く実測できないため、確認はユーザーが実施した(この項目の検証者はユーザー)

### セッション8 検証記録(2026-07-25、375x812 / Vite dev)

Browser ペーンは `visibilityState=hidden` で rAF が完全停止する(Notes 既知)ため、セッション2/4と同じ **rAF キュー化ハーネス**で検証した。今回はさらに `matchMedia("(pointer: coarse)")` を true に差し替えたうえで `import("/src/app.ts")` → `initApp()` でアプリを再起動し、**タッチ端末の分岐そのもの**を動かしている。

| 検証項目 | 実測 |
|---|---|
| レール幅 = canvas 幅 | 両方 left=16 / width=343、間隔 8px(Assumption 検証) |
| 発射ガイドの文言(coarse) | 「タップで発射」 |
| レール 25% をタッチ | パドル中心 239.5(期待 240)、ハンドル `left: 25%` |
| 90% へドラッグ | パドル中心 863.5(期待 864)、ハンドル `left: 90%` |
| レール右端の外までドラッグ | パドル中心 919.5(可動域上限 920 にクランプ)、ハンドル `95.8333%`(ハンドル右端がちょうど 100%) |
| 押している間 | ガイド表示のまま = 未発射 |
| 指を離した直後 | ガイドが消える = 発射 |
| 初回タッチ | `data-touched="true"` が付き、ヒントの computed opacity が 0(トランジション無効時に実測。ハーネスは実描画しないので通常時は 1 のまま止まる) |
| ライト/ダーク | 375px でスクリーンショット確認。ヒントは 1 行(高さ 11px)に収まる |

- **CSS の `@media (pointer: coarse)` だけは実測できていない**(ペーンにも実 Chrome にもタッチエミュレーションが無く、iOS シミュレータは Xcode 未導入で利用不可)。JS 側の coarse 分岐は上記のとおりスタブで実測済み。実機での最終確認はデプロイ後に手元のスマホで行う

#### レビュー修正後の再検証(同ハーネス、`pointerType` 付きの実 PointerEvent で実測)

| 検証項目 | 実測 |
|---|---|
| 発射ガイド(coarse) | 「下のバーで発射」/ レールは `aria-hidden="true"` |
| 盤面をタッチ(移動+タップ) | パドル 479.5 のまま・ガイド出たまま = **盤面はタッチを一切拾わない** |
| レール 25% をタッチ(指1) | パドル 239.5、ハンドル 25% |
| 指2 がレールを押して離す | パドル 239.5 のまま・未発射 = **2本目の指はドラッグを奪わない**(H1) |
| 指1 を 90% へ | パドル 863.5、ハンドル 90% = 所有権が維持されている |
| 指1 を離す | 発射 |
| 盤面をマウスで操作 | パドル 287.5(期待 288)= デスクトップの挙動は無変更 |
| ゲームオーバー時のレール | `data-inactive="true"` / `pointer-events: none` / `opacity: 0.4`、タッチしてもハンドルが動かない |
| 375x667(iPhone SE 相当) | `scrollHeight === innerHeight`(縦横ともあふれ無し)、フッター下端 538px |
| ミューテーション | `ownsPointer` の pointerId 比較を外すと2件 fail(修正前コードで落ちることを確認) |

#### 再レビュー修正後の再検証(同ハーネス)

| 検証項目 | 実測 |
|---|---|
| coarse スタブ有り(スマホ相当) | ガイド「下のバーで発射」/ `aria-hidden` は無し / 盤面タッチは無反応・未発射 / レール 25% → 239.5・90% → 863.5 / 2本目の指は無視 / 離すと発射 / マウスは盤面追従 287.5 |
| **coarse 無し + レール非表示(タッチスクリーン付きノート PC 相当)** | `matchMedia("(pointer: coarse)")` false・`.paddle-rail` は `display: none`・幅 0。この状態で**タッチ**を盤面に落とすとパドル 287.5(期待 288)へ追従し、発射もされる = H-A のフォールバックが実ブラウザで機能 |
| ミューテーション(計6種) | 上記タスク欄に記載。すべて修正前コードで fail することを確認 |

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
## セッション9: Lighthouse によるパフォーマンス改善 + 継続計測(完了 2026-07-25)

対象は apps/web(公開ページ)のみ。拡張は計測対象外(ページ所有者が GitHub)。

### ベースライン(実測 2026-07-25、Lighthouse 12.6.1 / mobile / `lhci collect --staticDistDir=apps/web/dist`)

| カテゴリ | スコア |
|----------|--------|
| Performance | **88** |
| Accessibility | 100 |
| Best Practices | 96 |
| SEO | 100 |

| 指標 | 値 |
|------|-----|
| FCP | 3.0 s (score 0.48) |
| LCP | 3.0 s (score 0.77) — LCP 要素 `p.subtitle`、内訳は **Render Delay 2,579ms = 85%** |
| TBT | 0 ms |
| CLS | 0.005 |

原因は 1 つに収束する: **head の Google Fonts CSS 2 本がレンダーブロッキング**(`render-blocking-resources` Est savings 2,220ms)。

- `IBM+Plex+Sans+JP` の CSS が 60,776 B(unicode-range が大量。`unused-css-rules` は 100% 未使用と判定)
- `DotGothic16`(text= サブセット)の CSS は 1,072 B だが、fonts.googleapis.com への往復だけで wastedMs 836
- 副次: `errors-in-console` が favicon.ico の 404 で score 0(Best Practices 96 の原因)

### Constraints(このセッション)

| 制約 | 出典 | 検証方法 |
|------|------|----------|
| 書体は変えない(DotGothic16 / IBM Plex Sans JP) | DESIGN-VISUAL §1 | index.html / style.css の font-family 差分 |
| ゲーム挙動・見た目を変えない | ユーザー依頼はパフォーマンスのみ | packages/core の差分 0 行、既存テスト全 pass |
| 新規ランタイム依存を増やさない | rules/constraints.md | apps/web/package.json の dependencies 差分 0 |
| CI は既存 ci.yml を壊さない | rules/pr.md | ci.yml と別ワークフローに分離 |

### Assumptions

| 仮定 | Status | 根拠 |
|------|--------|------|
| FCP/LCP のボトルネックは Google Fonts CSS のレンダーブロッキング | VERIFIED | 上記 `render-blocking-resources` / LCP Render Delay 85% |
| `media="print"` → onload で `all` に戻す方式で Lighthouse がレンダーブロッキングと見なさなくなる | VERIFIED | 対策後の再計測(下記「改善後」)で `render-blocking-resources` が 0 件 |
| GitHub Actions の ubuntu-latest には Chrome が同梱され lhci が起動できる | VERIFIED | PR #17 の Lighthouse / dist ジョブのログ `✅ Chrome installation found` → 3 runs 実行 → assertion 全通過(run 30150112214、47 秒) |
| `uses-long-cache-ttl` は自前資産の問題ではない | VERIFIED | 本番実測で対象は Cloudflare Insights のビーコンと fonts.gstatic.com の 2 件のみ(どちらも第三者) |

### タスク

- [x] 対策1: Google Fonts CSS 2 本を非ブロッキング化(`media="print"` + `onload` で `all`、`<noscript>` フォールバック付き)
  - 検証: `render-blocking-resources` が 3 件 → 1 件(残る 1 件は自前の `/assets/*.css` 1.9KB・152ms)、FCP/LCP とも 3.0s → 0.9s
- [x] 対策2: favicon を追加して console 404 を解消(`apps/web/public/favicon.svg`)
  - 検証: `errors-in-console` が 0 → 満点、Best Practices 96 → 100。ブラウザで `link[rel=icon]` の解決を実測
- [x] 対策3: `document.fonts.load('16px "DotGothic16"')` を `link[data-font="display"]` の load 後に蹴るよう `main.ts` を修正
  - 検証: ビルド成果物を `vite preview` で開き `document.fonts` を実測 — `DotGothic16:loaded` / `document.fonts.check('16px "DotGothic16"') === true`。スクリーンショットでも canvas 内 HUD(`DEMO PLAY`)がピクセルフォントで描画されている
- [x] 対策4(本番計測で発見): `robots.txt` を追加。Cloudflare Pages が存在しないパスに index.html を 200 で返すため、クローラーが HTML を robots.txt として解釈していた(本番 SEO 92 / robots-txt 49 errors)
- [x] 継続計測: `lighthouserc.cjs` + `.github/workflows/lighthouse.yml` + `pnpm lh` / `pnpm lh:prod`、レポートは artifact に 30 日保存
  - 検証(ネガティブテスト): index.html から `media="print" onload=...` を外して `pnpm lh` → **exit 1**(`render-blocking-resources` 3 > 1、LCP 3.1s > 2.5s)。ゲートが実際に落ちることを確認してから元に戻した
- [x] 改善後の再計測とベースライン比較を本ファイルに記録(下記)
- [x] PR → CI green — https://github.com/toshi0607/kusakuzushi/pull/17。`test` pass 46s、`Lighthouse / dist` pass 47s(ランナーで Chrome 起動 → 3 runs → assertion 全通過)、`Lighthouse / production` は PR では skip される設計どおり
- [x] マージ → `wrangler pages deploy` → 本番で `pnpm lh:prod` を再実行して green を確認 — PR #17 マージ(40dadd2、2026-07-25 07:58)。本番 green の確認自体はセッション12 が引き取り、デプロイ(`0663da25`)後に `Lighthouse` ワークフローを workflow_dispatch で実行(run 30161863485)して `production` ジョブ **success**(中央値 perf 99 / FCP 1013ms / LCP 2005ms / render-blocking 0)。詳細はセッション12 の A-11

### 結果(dist / mobile / 3 runs)

| | ベースライン | 改善後 |
|---|---|---|
| Performance | 88 | **100** |
| Accessibility | 100 | 100 |
| Best Practices | 96 | **100** |
| SEO | 100 | 100 |
| FCP | 3.0 s | **0.9 s** |
| LCP | 3.0 s | **0.9 s** |
| CLS | 0.005 | 0.005(悪化なし) |
| TBT | 0 ms | 0 ms |

本番(https://kusakuzushi.toshi0607.com/、デプロイ前の実測)は performance **78** / SEO 92 / FCP 3.8s / LCP 4.1s。
ローカル配信より数値が悪いのは実回線と Cloudflare の TTFB が乗るため。**この PR をデプロイするまで
`pnpm lh:prod` は落ちる**(render-blocking 3 件、FCP/LCP 超過)。デプロイ後に再計測して確認すること。

### 見送った改善

- **自前 CSS(1.9KB)のインライン化**: 残る唯一のレンダーブロッキングだが Est savings 150ms で、
  すでに performance は 100。`<style>` 直挿しには Vite プラグイン(新規依存)が必要なので入れない
- **IBM Plex Sans JP の削減**(フォント転送 109KB / 12 リクエスト): 書体は DESIGN-VISUAL §1 の指定であり
  パフォーマンス都合で変えない。FCP 後のロードなので描画は止めていない
- **`uses-long-cache-ttl`**: 本番で引っかかるのは Cloudflare Insights のビーコンと fonts.gstatic.com の
  フォント(どちらも第三者・TTL 24h)で、自前の資産は対象外。assert は warn 止まりにしてある

## セッション10: ブロック破壊時のアイテムドロップ(完了 2026-07-25)

ユーザー要望(2026-07-25): 「たまにブロックを崩したときにアイテムが降ってくるようにしてください」
- 玉の数が増える
- バーの数が一時的に増える

バー増加の挙動は **メインパドルの左右に追加バーが1本ずつ出て3本が一緒に動く**(ユーザー選択 2026-07-25)。

### Constraints(セッション10)

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

### Assumptions(セッション10)

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
- [x] ブラウザ実機でアイテム取得までプレイ検証 — 下記「セッション10 検証記録」
- [x] DESIGN.md §3 / DESIGN-VISUAL §5 にアイテム仕様を追記
- [x] 自己レビュー(このセッションはサブエージェント禁止の実行環境のため reviewer エージェントは使わず、差分の通読で代替)。見つけた点: クリア時に落下中アイテムが結果画面へ凍りついたまま残る → `clear` 遷移時に `items` を空にする修正を入れた
- [x] ユーザー指摘の調整(2026-07-25): アイテムを青に / 玉を「めちゃくちゃ多く」増やせるように — 下記「調整の記録」
- [x] PR → CI green → マージ — https://github.com/toshi0607/kusakuzushi/pull/18(`test` pass 40s / `Lighthouse / dist` pass 1m25s → merge 7b16daf、2026-07-25 08:04)。その後の調整(アイテム色・3分裂)は [#26](https://github.com/toshi0607/kusakuzushi/pull/26)(merge 199659d)で別途反映済み

### 調整の記録(ユーザー指摘 2026-07-25)

指摘: 「アイテムの色を青とか別の色に」「玉の数はめちゃくちゃ多くまで増やせる(草が多いとぜんぜん終わりに到達できない)」

1. **色**: `Theme.itemColor` を light `#0969da` / dark `#58a6ff` で埋め、拡張の `OverlayTheme` にも `itemColor` を追加。玉のアンバーと同色だと「追う物」と「ただの玉」が見分けにくかったため
2. **玉の増え方**: `multiBallSpawnCount`(固定+2)を **`multiBallSplitFactor`(飛んでいる玉を全部 N 倍)** に置き換え、`maxBalls` 5 → 200。固定加算では取っても線形にしか増えず、371 ブロックの盤面では刈り切れないという指摘そのものが直らないため、複利で増える形にした
3. **上限200の根拠(実測)**: 371 ブロック盤面での `update()` は 1玉 0.02ms / 25玉 0.29ms / 121玉 0.49ms(16.7ms 予算)。ブラウザ実測でも 191〜196 玉で `update` 0.35〜0.39ms・`render` 0.6〜2.4ms。上限はバランス調整用ではなく暴走時のバックストップ
4. **実測(ブラウザ)**: ドロップ率100%の一時ページで玉が 1→2→4→8→16→191→196(上限)と複利で増え、**371ブロックの盤面が `clear` に到達**(スコア 3,717)。青タイルは light/dark 両方でスクリーンショット目視確認(アンバーの玉と明確に別物に見える)
5. **序盤の加速**(ユーザー指摘「初期もう少し加速できますか」2026-07-25): ドロップ確率を固定 8% から **序盤 22% → 終盤 8% の線形ランプ**に(`earlyItemDropBonus = 0.14`、破壊済み割合で補間)。立ち上がりは玉1個で手が足りず、そこを厚くしないと複利が始まらないため。終盤は玉が増えているので絞る。ユニットテストは「同じ乱数値が序盤は通り終盤は弾かれる」形で検証(フラット確率に戻すと落ちる)。371ブロック盤面の 180 秒シミュレーション(完璧オートパイロット、3シード)では flat 8% が 3回とも 6ブロックだったのに対し、ランプありは 1回が 21ブロック(アイテムを拾って複利が始まった回)

### 調整の記録2(ユーザー指摘 2026-07-25)

指摘: 「アイテムをとるとたまが2個になるので3個に」「玉増やすアイテムとバー広くするアイテムの色を変える」

1. **分裂数**: `multiBallSplitFactor` 2 → **3**(取るたび 3→9→27…、上限200は据え置き)。`game.test.ts` の複利テストの期待値を `[2,4,8]` → `[3,9,27]` に更新
2. **アイテム色の分離**: `Theme.itemColor`(単色)を **`Theme.itemColors: Record<ItemKind, string>`** に置き換え、玉増加=青(light `#0969da` / dark `#58a6ff`)、バー増加=紫(light `#8250df` / dark `#a371f7`)。拡張の `OverlayTheme.itemColor` も同様に `itemColors` へ。記号(3点/3本)が読める距離まで落ちてきた頃にはもうパドル直前で、追うかどうかを色だけで判断できる必要があるため
3. **実測(ブラウザ)**: dev サーバ上の一時ページで light/dark × 2種を描画し、タイル中心のピクセルを `getImageData` で読み取り `#0969da` / `#8250df` / `#58a6ff` / `#a371f7` を確認。スクリーンショットでも青と紫が別物に見えることを目視確認(一時ページは検証後に削除)
4. **テスト**: 全ワークスペース green(core 54 / extension 49 / web 56 / ogp 66)、`pnpm -r build` exit 0
5. **PR → マージ → デプロイ**(2026-07-25): https://github.com/toshi0607/kusakuzushi/pull/26(`test` pass 38s / `Lighthouse dist` pass 1m7s / `slow` pass 1m13s → merge 199659d)。`wrangler pages deploy dist --project-name kusakuzushi --branch main`(cbcdad1e)。本番検証: `https://kusakuzushi.toshi0607.com/assets/index-SQEC_6xV.js` の shasum が手元の dist と一致(40f6e85e…)、配信 JS に `multiBallSplitFactor:3` と紫 `#8250df` / `#a371f7` を確認、本番画面のスクリーンショットも正常

### セッション10 検証記録(2026-07-25 実ブラウザ実測)

`itemDropChance: 1` に固定した一時ページ(`apps/web/item-check.html`、検証後に削除)を Vite dev で開き、core の `Game` + `render()` を同期駆動して実測。

| 検証項目 | 実測結果 |
|----------|----------|
| ドロップ | 120フレームで `items: ["multiBall"]` が出現(ブロック中心から落下) |
| 玉増加 | 取得で `balls: 1 → 3`、以降も取り続けて `balls: 5` で頭打ち(`maxBalls`) |
| バー増加 | 取得で `bars: 1 → 3`。座標実測 main `x=350 w=80` / 左 `x=304 w=40` / 右 `x=436 w=40`、全て `y=444` — 隙間はちょうどボール半径 6px |
| 効果時間 | 取得直後 `extraPaddleRemaining = 11.98`(12秒から減衰) |
| 描画 | スクリーンショット目視: アンバーのタイルに「3本バー」「3点」の記号、玉3個とバー3本が同時に描画される |
| 実アプリ | `/` から `@toshi0607`(3,012 contributions)でセッション開始 → rAF ハーネスで 1200 フレーム駆動してループ生存・盤面描画を確認 |

## セッション11: ブロックを正方形にする(草グラフ実寸比)(完了 2026-07-25)

ユーザー指摘「ブロックを正方形にして本家のデザインに近づけると変ですか？意図的に長方形にしてないならデザインして」。

診断: **意図的ではなく実装漏れ**。DESIGN.md §3 は「キャンバスは草の実寸比(横長)を維持し、下に余白を付けてパドル空間にする」と定めているのに、web 版だけ `DEFAULT_CONFIG` の 960x480 という固定値が先にあり、`computeLayout` が高さを `canvasHeight/2` から**逆算**するため 16.1 x 31.7px(1:1.97 の縦長)になっていた。拡張版 `deriveConfig`(実 td の正方 10px から canvasHeight を逆算)も OGP の `grid-svg`(11px 正方 + rx2)も既に正方形で、web のゲーム盤だけが外れている。

方針: 「セルは正方形」を core の不変条件に格上げする。各アプリが canvasHeight を解いて正方形を*達成する*のではなく、`computeLayout` が幅からセルの一辺を決める。

### 幾何(960 幅 / 53 列)

| 項目 | 現状 | 変更後 |
|---|---|---|
| ブロック | 16.08 x 31.71(gap 2) | 14.04 x **14.04**(gap 4) |
| 隙間比(gap / ストライド) | 11% | **22%**(本家 3/13 = 23%) |
| 草の帯(brickAreaTop+brickAreaHeight) | 240(canvasHeight/2) | 134.3 |
| canvasHeight | 480(2:1) | **360**(8:3) |
| 草下端→パドル上端の距離 | 204px | 190px(ゲーム感を維持) |
| 草の占有率 | 50% | 37%(パドル空間 63%) |

canvasHeight を 360 にした理由: 480 のままだと草が上端の細い帯になり残り 2/3 が空洞、拡張版と同じ `2 x 草の帯` = 261 だとパドル空間 130px でモバイルが窮屈。360 は**ボールの往復距離を現状(204px)とほぼ同一に保つ**唯一の値で、ゲーム感を変えずに見た目だけ直せる。

### Constraints

| Constraint | Source | Verify by |
|---|---|---|
| 拡張版のオーバーレイ位置合わせを 1px も狂わせない | 拡張は本物の td に重なるのが核(DESIGN.md §5) | `adapter.test.ts` の `brickHeight === 10` / `y === 3 + row*13` が無改変で pass |
| core の公開 API を壊さない | 拡張・OGP が依存 | `pnpm -r build` exit 0、既存テスト無改変 pass |
| 緑は草だけ / HUD は無地帯に置く | DESIGN-VISUAL §0・§5、lessons(セッション7) | HUD の y を草の帯の下端から導出(canvasHeight/2 のハードコードをやめる) |
| 発射ガイドを草にも HUD にも重ねない | セッション6・7 の既存修正 | 実測スクショで間隔を確認 |

### Assumptions

| Assumption | Status | Evidence |
|---|---|---|
| 現ブロックは 16.08 x 31.71 の縦長 | VERIFIED | game.ts:107-108 の式に 960/53/gap2 を代入(= (960-108)/53, (238-16)/7) |
| 拡張版は既に正方形セル | VERIFIED | adapter.ts:74-79 + todo.md セッション4「セルは正方 10px、stride 13px」実測 |
| `brickHeight = min(幅由来, 従来の高さ由来)` なら拡張版の値は不変 | VERIFIED | 実測値 cell10/gap3/H194 で従来式 (97-3-24)/7 = 10、幅由来も 10 → min は 10 |
| 共有画像は canvas のアスペクト比に自動追従する | VERIFIED | share.ts:85 `boardHeight = boardWidth * source.height / source.width` |

### タスク

- [x] core `computeLayout`: `brickHeight = min(brickWidth, 従来の高さ由来の上限)`、`brickAreaHeight` は実占有量から算出。`DEFAULT_CONFIG.canvasHeight` 480 → 360
  - 上限を残したのは安全弁。幅に対して低すぎる canvas を渡されたときにブロックが潰れる(= パドル空間を侵さない)ほうが、はみ出すより安全。拡張版の実測値(cell10/gap3/H194)では上限も幅由来も 10 で一致するため挙動不変
- [x] core `Game.layout` ゲッター公開 + `renderer` の HUD を `canvasHeight/2` ではなく草の帯の下端に紐付け
- [x] apps/web: `.board-placeholder` の aspect-ratio 2/1 → 8/3、`.guide-overlay` を `top: 36%`(草の下端)へ
- [x] リザルトパネルがモバイルで溢れる回帰を修正 — 盤面高が 187px → 130px に縮んだため。≤560px で padding 6px / gap 4px、ラベルの行間 1.2、草セル 7px 角(10:3 比は維持)まで一段ずつ縮小。**4 ブロックはどれも落とさない**(初回は刈り取り率バーを非表示にしたが、ユーザー判断で「全部残して縮める」に変更)
- [x] 共有画像の盤面を 880px → 1080px 幅へ。8:3 の盤面だと 880 ではカード下部に 130px の空白が残るため
- [x] テスト更新・追加(正方形・帯がパドルに侵入しない・短い canvas での潰れ・HUD 行の導出)— core 41 tests、全体 178 tests pass
- [x] DESIGN.md §3 / DESIGN-VISUAL.md §3・§5・レスポンシブ を実装に合わせる
- [x] セルフレビューでの追加対応(2 件)
  - **拡張版の位置合わせに新しい前提が混入していた**: `brickHeight = min(brickWidth, 上限)` にしたことで、拡張版のブロック高が実測 `cellHeight` ではなく `min(cellWidth, cellHeight)` になっていた。`measureGeometry` は幅と高さを別々に実測し行ストライドの不一致を warn する = 両者がズレうる前提の設計なので、ズレた場合に行ごとに浮く。`GameConfig.brickHeightPx`(実 DOM に重ねるホスト用の明示指定)を追加し adapter が実測値を渡す形に。非正方セル(10x11)の回帰テストを追加し、**修正前は落ちることを実測**
  - **隙間比が本家と違った**: 正方形にしても gap 2 では隙間がストライドの 11%(本家 23%)で、一枚の緑の板に見えて 1 日 1 セルが読めない。`brickGapPx` 2 → 4(セル 14.04px、隙間比 22%)。帯の高さは 130 → 134px でほぼ不変なので canvas 高・ガイド位置への影響は軽微
- [x] 2 巡目レビューでの追加対応(1 件)
  - **隙間を広げた副作用でアトラクトのワードマークが崩れた**: 文字セルが level 3/4 の市松だったため、隙間 22% が入ると 3 セル幅のストロークがディザに見え「KUSAKUZUSHI」が読めなくなっていた。シグネチャー要素の劣化なので即修正 — 文字を level 4 のベタに。テストも `>= 3` から `=== 4` に締めて、濃淡を戻したら落ちるようにした。light/dark 両方で字形を実測確認
- [x] PR → CI green → マージ → デプロイ → 本番確認 — https://github.com/toshi0607/kusakuzushi/pull/19(CI test pass 39s / Lighthouse dist pass 1m8s → merge be37322)、`wrangler pages deploy`(9a3c4d49)、本番 https://kusakuzushi.toshi0607.com/?user=toshi0607 で内部解像度 960x360・セル 14.04px・隙間比 0.222・草の帯 37.3% を実測
- [x] main(16 コミット進行)を取り込み。アイテムドロップ機能との整合を確認 — itemSize 14px はセル 14.04px とほぼ一致し「1 セル角」になるので拡張版の `itemSize: cellHeight` と同じ意味。itemFallSpeed 120px/s は表示スケールが変わらないため据え置き(他セッションの調整値を動かさない)

### 検証記録(2026-07-25、dev サーバ実測)

| 項目 | 結果 |
|---|---|
| テスト | `pnpm -r test` 178 pass(core 41 / ogp 65 / web 28 / extension 44)。拡張版の幾何整合テスト(`brickHeight === 10`、`y === 3 + row*13`)は**無改変で pass** = オーバーレイのズレなし |
| ビルド | `pnpm -r build` exit 0 |
| 盤面(1280px) | 1040x391、セル 14.04px 正方 / 隙間比 0.222(本家 0.231)、草下端 = 上から 134px。HUD 行 → ガイド 79px、ガイド → パドル 72px |
| 盤面(375px) | 343x130。HUD 行 → ガイド 19px、ガイド → パドル 15px(重なりなし) |
| リザルト(375px) | 内容高 128px ≤ 盤面 130px でスクロールなし。見出し / スコア・刈り取り率 / 刈り取り率バー / ボタン 3 つの 4 ブロックすべてが読める大きさで収まる |
| リザルト(1280px) | 刈り取り率バー込みで余裕。中央配置のまま |
| 共有画像 | 1200x630 に 1080x405 の盤面 + 成績行。実際に `composeResultImage` を呼んで目視(盤面ピクセルが `#9be9a8` で描かれていることも実測) |
| light / dark | 両モードでスクリーンショット確認。アトラクト画面のピクセル文字「KUSAKUZUSHI」も正方セルになり字形が正しくなった |

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

- 2026-07-25 (S9): **lhci の設定切り替えに `LHCI_` 始まりの環境変数を使ってはいけない**。lhci は `LHCI_*` を自分の CLI 引数として読むため、`LHCI_TARGET=production` が upload の `--target production` になり `Invalid values: target` で落ちる。`KUSAKUZUSHI_LH_TARGET` に改名して解消
- 2026-07-25 (S9): lhci の assert 既定 `aggregationMethod` は **optimistic**(3 回のうち最良回だけを見る)。回帰ゲートとしては甘いので `median` を明示している
- 2026-07-25 (S12): **lhci の `collect --url=...` は rc の `staticDistDir` に負ける**。`staticDistDir` が設定されたままだと lhci は自分の静的サーバをランダムポートで立て、`--url` で渡した URL を無視してそちらを測る。切り分け用に自前サーバを立てて `--url` で差し込む、という使い方は**黙って別のページを測る**ので必ず失敗する(セッション12 で 8 通りの比較を丸ごと無駄にした)。判別方法: レポートの `finalDisplayedUrl` が渡したポートかどうかを見る。バリアント比較をするならバリアントごとに rc ファイルを書いて `--config` で渡すこと。
- 2026-07-25 (S9): Cloudflare Pages は存在しないパスに index.html を **200** で返す。`/robots.txt` が HTML になっていて Lighthouse SEO が 92 に落ちていた。`apps/web/public/` に置けば解決する(404 ページの挙動を前提にしないこと)

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

## セッション10: ファビコン(意匠の作り直しと、抜けている面の追加)(完了 2026-07-25)

依頼は「ファビコンつけてください」。着手時点で `apps/web/public/favicon.svg` は既に存在したが、
セッション9で **console の 404 を消すためだけに** 置いたもので、意匠の検討は通っていなかった。
調査の結果、その SVG は**そもそもブラウザで描画されていなかった**(下記 A-1)。

### Constraints

| 制約 | 出典 | 検証方法 |
|------|------|----------|
| 緑は草(コンテンツ)専用。UI/操作系のアクセントはアンバー1色 | DESIGN-VISUAL §0 最重要ルール | favicon.svg の fill 値 |
| ページ側トークン(soil / marquee)から色を採る | DESIGN-VISUAL §1 | 同上 |
| Lighthouse 4カテゴリ 100 を維持(セッション9の成果) | tasks/todo.md セッション9 | `pnpm lh` が exit 0 |
| 新規 npm 依存を増やさない | rules/constraints.md | package.json の差分 0 |
| 拡張はページに独自デザインを持ち込まない | DESIGN-VISUAL 冒頭 | content script / DOM 生成コードの差分 0(manifest の `icons` のみ) |
| ゲーム挙動を変えない | 依頼はアイコンのみ | packages/core の差分 0、既存テスト全 pass |

### Assumptions

| 仮定 | Status | 根拠 |
|------|--------|------|
| A-1: main の `favicon.svg` は XML として不正で、ブラウザが描画に失敗する | VERIFIED | コメント内に `--marquee` の二重ハイフン(XML 仕様でコメント内 `--` は禁止)。**Chrome 実測**: `--headless --screenshot` で開くと画像ではなく `This page contains the following errors: error on line 4 at column 12: Comment must not contain '--' (double-hyphen)` のエラーページが出る。libxml2(rsvg-convert)と expat(python minidom)も fatal error で拒否 |
| A-2: iOS はホーム画面に SVG favicon を使えず apple-touch-icon.png が要る | UNVERIFIED-ACCEPTED (2026-07-25) | 実機 iOS が手元に無く実測できない。ただし PNG を置くこと自体に副作用が無く(未対応環境は無視するだけ)、置かない場合の劣化(ホーム画面がページのスクショになる)の方が大きいので受容 |
| A-3: Cloudflare Pages は存在しないパスに index.html を 200 で返す | VERIFIED | セッション9の robots.txt で実測済み(SEO 92 / robots-txt 49 errors の原因)。よって `/favicon.ico` も実体を置かないと HTML が返る |
| A-4: `.ico` を併記しても対応ブラウザは SVG を選び、余分な取得は起きない | VERIFIED | Lighthouse の network-requests に `/favicon.svg` 200 の 1 件のみ。`.ico` は取得されていない |
| A-5: manifest の `icons` が参照するファイルが dist に無いと Chrome が拡張の読み込みを拒否する | VERIFIED | build.mjs で dist へコピーするようにし、`ls apps/extension/dist/icons` で 4 ファイル生成を確認 |

### 意匠

viewBox を 32 → **16 単位**に変え、全図形を整数座標に置いた。DESIGN-VISUAL 冒頭の
「草グラフは本物のピクセルグリッド」を favicon にも通す = 16px 表示で 1 図形が整数ピクセルに落ちる。

- 地は `--soil` `#0C110D`(夜の畑)。**旧案は地が緑(`#216e39`)で「緑は草だけ」の規則に反していた**
- 上段に草ブロック 3 つ。左から `#30a14e` → `#40c463` → `#9be9a8` で、level = HP が減った状態を表す
- ボールは 3x3 の正方形。ゲーム本体は円だが、16px では半径 1.5px の円が十字のにじみになり読めない
  (実測: 変種比較 `vA` で確認)。元祖 Breakout のボールも正方形なので題材から外れない
- パドルはピル形(core の renderer と同じ `radius = height / 2`)。アンバーで下端に置くと 16px でも
  ブロックと混同されず「ブロック崩し」だと読める
- 旧案(2x2 の草 + 円のボール)は 16px では緑の四角に見えるだけでゲーム性が読めなかった

### タスク

- [x] `apps/web/public/favicon.svg` を再設計(XML 不正も同時に解消)
  - 検証: `python3 -c "import xml.dom.minidom as m; m.parse(...)"` が pass。16/32/64/180px にラスタライズして目視
- [x] `apps/web/public/favicon.ico`(16+32 マルチサイズ)を追加 — Pages が `/favicon.ico` に HTML を返すのを防ぐ
  - 検証: `identify` で `ICO 16x16` / `ICO 32x32` の 2 面を確認
- [x] `apps/web/public/apple-touch-icon.png`(180x180)を追加。生成元は `apps/web/tools/apple-touch-icon.svg`
  (iOS が自前で角丸マスクをかけるため、角丸なしの全面塗り + 2 単位の余白)
- [x] `apps/web/index.html` に `.ico` / `.svg` / `apple-touch-icon` の 3 本を記述
- [x] Chrome 拡張にアイコンを追加(`apps/extension/icons/icon-{16,32,48,128}.png` + manifest の `icons`)。
  これまで `icons` が無く、拡張一覧では既定のパズルピースが出ていた
  - 検証: `pnpm build` 後 `apps/extension/dist/icons/` に 4 ファイル、`dist/manifest.json` が同じパスを指す
- [x] `apps/extension/build.mjs` が `icons/` を dist へコピーするよう修正
- [x] `pnpm -r test` 全 pass(core 含め 4 パッケージ)
- [x] `pnpm lh` が exit 0。Performance / Accessibility / Best Practices / SEO = **100 / 100 / 100 / 100**(退行なし)

### 見送った

- **site.webmanifest**: 依頼はファビコン。ホーム画面追加時のアイコンは apple-touch-icon で足り、
  manifest を足すとアプリ名・theme_color・display の管理箇所が増えるだけなので入れない
- **OGP Worker の `/share/{user}` HTML への icon 追加**: あの HTML はクローラー専用(人間は 302 でアプリへ飛ぶ)
- **PNG 生成の npm 依存化**: rsvg-convert / ImageMagick は Homebrew のローカルツールとして使い、
  生成物をコミットする(og.png と同じ方針)。再生成コマンドは `apps/web/tools/apple-touch-icon.svg` のコメントに記載

### PR → マージ → デプロイ

- [x] PR → CI green → マージ — https://github.com/toshi0607/kusakuzushi/pull/21(`test` pass 36s、`Lighthouse / dist` pass 1m10s、`production` は PR では skip される設計どおり → merge 6ebeda1)
- [x] Cloudflare Pages デプロイ — `wrangler pages deploy dist`(947ab5fc)。**PR #18(アイテムドロップ)がブランチ作成後に main へ入っていたため、この配信にはその機能も含まれる**
- [x] 本番実測(2026-07-25)
  - `/favicon.svg` 200 `image/svg+xml` 1507B / `/favicon.ico` 200 `image/vnd.microsoft.icon` 5430B / `/apple-touch-icon.png` 200 `image/png` 1049B
  - `.ico` が `image/vnd.microsoft.icon` で返る = Pages の「存在しないパスに index.html を 200」の罠を塞げている
  - Chrome(`--headless --screenshot`)で本番の `/favicon.svg` を開き、エラーページではなくマークが描画されることを確認

### 未解決(このセッションの範囲外・別件)

**`pnpm lh:prod` は本番で赤のまま**(performance 76、FCP 4.1s / LCP 4.0s、しきい値は 1.8s / 2.5s)。
セッション9 の最後の未チェック項目「デプロイ後に本番で green を確認」の答えは **green にならない**。

- ファビコンの変更が原因ではない: 同一コミットの `pnpm lh`(dist)は 100/100/100/100。
  本番の network-requests でも `/favicon.svg` は最後(796ms)に 1458B で取得されるだけでクリティカルパスに乗らない
- セッション9 の対策自体は効いている: `render-blocking-resources` は本番でも 1 件(自前 CSS 2.1KB)まで減っている
- それでも FCP が 4.1s なのは、lhci の**モバイル・シミュレーション上のスロットリング**が実回線の
  往復(fonts.googleapis.com → fonts.gstatic.com のクロスオリジン 2 段)に乗るため。
  実測の wall clock では全リソースが 940ms で終わっている
- デプロイ前(セッション9 実測)は 78 / FCP 3.8s / LCP 4.1s。今回は 76 / 4.1s / 4.2s で、
  3 runs の LCP が 3.23 / 4.00 / 4.24s とばらつくので**この差は誤差**。改善も退行もしていない
- 次にやるなら: 自前 CSS のインライン化(残る唯一の render-blocking)と、
  IBM Plex Sans JP の自前ホスト化 or サブセット化(60KB の CSS + 11 ファイルのフォント取得がクロスオリジン)
### セッション8 フェーズゲート(reviewer/opus, 2026-07-25)

判定: **初回 Request changes → 全件対応済み**。検証: `pnpm -r test` 190/190 pass(web 40 → 44 件)、`pnpm -r build` exit 0、`git diff main -- packages/core` 0行、緑=コンテンツ専用(レールの色は `--marquee` / `--field` / `--ridge` / `--ink-faint` のみ)を確認。

| ID | Sev | 内容 | 対応 |
|----|-----|------|------|
| H1 | High | レールが `dragging` boolean 1本で全ポインタを受けていた。**2本目の指**(盤面を触った指)の `pointerup` が window に上がるとドラッグが終了し、パドルがその指の x へ飛び、ボールが発射され、押したままの親指は以後効かなくなる | 修正: `activePointerId` を記録し、所有者以外の `pointermove`/`pointerup`/`pointercancel` と、ドラッグ中の `pointerdown` を無視。回帰テスト2件(pointerId 比較を外すと fail することを確認)+ 実ブラウザで指1/指2 を実測 |
| M1 | Medium | 盤面の `pointerdown` 即発射・`pointermove` 追従が残っていたため、レールを数 px 外した指が盤面に落ちて**元のバグを再現できる**。しかもガイド「タップで発射」とレール「離すと発射」が矛盾していた | 修正: 盤面は `pointerType === "touch"` を無視(マウス/ペンは無変更)。ガイドは実際に効く面を指す「下のバーで発射」に。DESIGN-VISUAL §3 に明文化 |
| M2 | Medium | 「他要素の pointerup で発射しない」テストが `pointerdown` 無しの経路しか通しておらず、危険な「ドラッグ中に他ポインタが来る」経路が未検証だった。`rect.width === 0` と 0.05% スロットルも未検証 | 修正: 上記 H1 の2件に加え、幅0のとき何もしないこと・サブピクセル更新を捨てることのテストを追加(計 44 件) |
| M3 | Medium | ブランチが main より2コミット遅れ、`tasks/todo.md` がコンフリクトする | 修正: main をマージし、セッション7 → セッション8 の順で解決 |
| L1 | Low | `rect.width === 0` のとき 0 を返すため、パドルが左端に飛ぶ(「不明」を「左端」と誤訳していた) | 修正: `null` を返して `onMove` を呼ばない |
| L2 | Low | ハンドルの clamp が `[0, canvasWidth]` で、両端ではハンドルが枠から半分はみ出す位置を許していた(しかもテストがそれを正解として固定していた) | 修正: `[w/2, canvasWidth-w/2]` にクランプ。テストも「右端がちょうど枠に一致」を検証する形へ |
| L3 | Low | `paddleX` が可動域ではなく `[0, canvasWidth]` 基準で、端をタッチした直後は矢印キーの最初の数十 ms が飲まれる(拡張版セッション4 R-L4 と同じ穴) | 修正: `clampPaddleX` を導入し、盤面パスとレールパスの両方に適用 |
| L4 | Low | ヒントが「もう一回」のたびに再表示される(DESIGN-VISUAL は「初回タッチで消える」と書いていた) | ラウンドごとの再表示は妥当と判断。挙動は維持 |
| L5 | Low | デスクトップでもレール DOM と window リスナを作っている | 表示条件の真実を CSS 1 箇所に保つため意図的に維持(早期 return のみのコスト) |
| L6 | Low | レールに accessible name が無く、AT からも隠していない | 修正: `aria-hidden="true"`(キーボード操作は矢印キーが担うため、狙えないジェスチャを読み上げない) |
| L7 | Low | DESIGN-VISUAL の「パドルは常に指の真下」は両端 4.17% で成り立たない | 修正(可動域で頭打ちになる旨を追記) |

### セッション8 再フェーズゲート(reviewer/opus, 2026-07-25、修正差分 7c6c63c 込みの全差分に対して)

判定: **Request changes → 全件対応済み**。前回の H1/M1/M2/M3/L1/L2/L6/L7 は Fixed、L3 は Partially fixed と判定された。検証: `pnpm -r test` 199/199 pass(web 53件)、`pnpm -r build` exit 0、`packages/core` 0行差分。

| ID | Sev | 内容 | 対応 |
|----|-----|------|------|
| H-A | High | **修正コミットが作った回帰**。`pointer: coarse` は*主*入力しか見ないので、タッチスクリーン付きノート PC(`pointer: fine` + `any-pointer: coarse`)ではレールが出ない。にもかかわらず盤面は `pointerType === "touch"` を無条件で無視していたため、**レールも無い・盤面も拒む = タッチ操作が完全に死ぬ**。DESIGN.md §3「マウス/タッチ追従」にも違反 | 修正: 盤面のタッチ譲渡を「レールが実際に表示されているか」(`rail.isVisible()` = `getBoundingClientRect().width > 0`)で判定。メディアクエリを唯一の真実にしたので CSS/JS が食い違わない。レールが出ない端末は従来どおり盤面追従にフォールバック。回帰テスト(可視判定を外すと fail)+ DESIGN.md / DESIGN-VISUAL §3 / Assumptions 行を訂正 |
| M-A | Medium | 今回の中心的な修正(盤面のタッチ無視・`clampPaddleX`・ガイド文言)が全て `session.ts` にあるのに、テストは `paddle-rail.ts` だけを見ていた。`session.ts` にはテストファイルすら無い | 修正: `apps/web/src/session.test.ts` を新設(7件)。拡張版 `game-runtime.test.ts` と同じく ctx / rect / rAF をスタブして実 `Game` を走らせ、ハンドル位置から実パドル位置を読む。タッチ/マウス/レール非表示時のフォールバック/レール操作と発射/ガイド文言/矢印キー/teardown を検証 |
| L-A | Low | `clampPaddleX` を矢印キーの累算に適用しておらず L3 が半分しか直っていない。壁に当て続けるとカーソルだけ 960 まで歩き、逆方向の最初の ~83ms が死ぬ | 修正: 3箇所すべて(盤面・レール・キーボード)を `clampPaddleX` 経由に統一。回帰テスト追加(クランプを戻すと fail することを確認) |
| L-B | Low | `activePointerId` が非 null のまま取り残されると、レールが以後まったく反応しなくなる(ウィンドウ外でボタンを離す等で終了イベントが届かない場合) | 修正: `setPointerCapture` + `lostpointercapture` でのリセットを追加(jsdom には無いので optional call)。回帰テスト追加 |
| L-C | Low | `aria-hidden="true"` が、可視のヒント文と唯一のタッチ操作面ごと AT から消していた。しかもガイドは「下のバーで発射」と、AT からは存在しない要素を指していた | 修正: `aria-hidden` を撤回(前回 L6 の対応を差し戻し)。レールは説明文を持つただの要素として AT に残す方が、ガイドの文言と整合する |
| L-D | Low | 未コミットの `style.css` 変更がレビュー範囲外にあった | 対応済み(レビュー中に行っていたハンドル垂直中央寄せの実験。実測でヒントとの間隔が 3px まで詰まるため不採用とし、理由コメントのみを 90363d2 でコミット) |
| L-E | Low | ドキュメントと実装の食い違い5件(DESIGN.md のタッチ記述、todo.md のガイド文言・テスト件数・ハイブリッド機の Assumption 行) | 修正(全件) |

## セッション12: 本番だけ Lighthouse が赤い件(依頼文の「セッション11」。11 は「ブロックを正方形にする」で使用済みのため 12 とした)

セッション10 の「未解決(このセッションの範囲外・別件)」の続き。
`pnpm lh`(dist)は 100/100/100/100 なのに `pnpm lh:prod`(本番)は performance 76 /
FCP 4.1s / LCP 4.0s で exit 1。**同じ成果物・同じしきい値でこれだけ割れる理由**から設計する。

### 依頼の分岐点への回答:「実ユーザーが遅いのか、しきい値が未校正なのか」

結論は **どちらでもなく「dist という計測条件が、この種の劣化を構造的に検出できない」**。

1. **しきい値は未校正ではない**。`lighthouserc.cjs` の FCP 1800ms / LCP 2500ms は
   Core Web Vitals の "good" 境界そのもの(モバイル)であって、dist の実測から
   逆算した値ではない。設定ファイルのコメントが「dist の実測を基準に」と書いているのは
   *余裕の確認*をした、という意味で、数値の出どころは標準側。本番へ適用するのは正当。
2. **実ユーザーは(まともな回線なら)遅くない**。本番の wall clock は全リソース 940ms で完了、
   server-response-time 170ms、maxRtt 128ms。4.1s は Lighthouse モバイル既定の
   シミュレーション(Slow 4G: RTT 150ms / 1.6Mbps / CPU 4x)を実グラフに載せた値。
   ただし **それは「実在しない条件」ではない** — モバイル回線の悪い側の実ユーザーを模したもので、
   赤いこと自体は「直す価値がある」という意味に読むのが素直。
3. **本当の問題は dist ゲートの側**。dist は localhost 配信で RTT ≒ 0 / server-response-time 19ms
   なので、**クリティカルパスの往復回数が何回だろうと 100 点が出る**。実際、下記の
   「FCP が JS を待っている」構造はセッション9 の時点で既にあったが、dist では一度も赤くならなかった。
   → しきい値を本番用に緩めるのではなく、**クリティカルパスを直し、dist ゲートに
   ネットワーク形状を持ち込む**のが正しい向き。

なお「実ユーザーが本当に遅いか」に決着をつけられるのはラボ値ではなく **フィールド値(CrUX)** だが、
個人規模のサイトは CrUX の収集閾値に届かないためデータが存在しない見込み。
よってラボのモバイル・スロットリング値を設計目標として扱う(= 上の 2 の判断)。

### 見つけた真因(コード読解、2026-07-25)

**トップページはクライアントレンダリングで、FCP が module JS の実行を待っている。**

- `apps/web/index.html` の body は `<div id="app"></div>` だけ
- `apps/web/src/app.ts` の `buildShell()` が header / main.stage / footer を
  `document.createElement` で組み立てて `root.replaceChildren(...)` している
- つまり FCP と LCP(要素は `p.subtitle`)の手前に
  **HTML → CSS(render-blocking)→ module JS → JS 実行** という鎖がある

localhost 配信ではこの鎖の各往復がほぼ 0ms なので `pnpm lh` は 1.0s で緑になる。
実オリジン(TTFB 170ms + シミュレーション RTT 150ms)では往復 1 回あたり 300ms 以上かかり、
そこに Slow 4G の帯域(1.6Mbps)を全リソースで分け合う分が乗る。

セッション9・10 が「フォントの往復」に原因を求めていたのは、
`render-blocking-resources` という監査名に引きずられたため。**フォント CSS は
セッション9 で既に非ブロッキング化済みで、FCP の鎖には乗っていない。**

### Constraints(セッション12)

| Constraint | Source | Verify by |
|---|---|---|
| 書体を変えない(DotGothic16 / IBM Plex Sans JP) | DESIGN-VISUAL §2(DotGothic16 は題材のピクセルグリッドと直結する唯一級の日本語ピクセルフォント) | index.html / style.css の font-family 差分 0 |
| ゲーム挙動と見た目を変えない | ユーザー指示 2026-07-25 | `git diff main -- packages/core` 0 行、既存テスト全 pass、レイアウト実測 |
| 新規ランタイム依存を増やさない | rules/constraints.md / DESIGN.md §4 | `apps/web/package.json` の dependencies / devDependencies 差分 0 |
| `pnpm lh`(dist)の 100/100/100/100 を落とさない | ユーザー指示 | PR の `Lighthouse / dist` ジョブ |
| CI(lighthouse.yml)を壊さない。`production` は PR で skip | ユーザー指示 / 既存設計 | ワークフローの `if:` 条件を保つ |
| マージ・デプロイはしない(PR まで) | ユーザー指示 | main への直接コミットなし |
| 生成物をコミットする方式は可(og.png / favicon.ico の前例) | ユーザー指示 | — |

### Assumptions(セッション12)

| Assumption | Status | 根拠 |
|---|---|---|
| A-1: FCP/LCP は module JS のダウンロードと実行を待っている(`#app` が空でシェルを JS が組み立てている) | VERIFIED | `apps/web/index.html`(body は `<div id="app"></div>` のみ)と `app.ts` の `buildShell()`。LCP 要素 `p.subtitle` は `buildShell` が生成している |
| A-2: しきい値 FCP 1800 / LCP 2500 は Core Web Vitals の "good" 境界であり dist 由来の値ではない | VERIFIED | 数値が mobile の "good" 境界と一致。dist の実測は FCP 0.9s で、この値からは導けない |
| A-3: localhost 配信では往復回数が FCP にほぼ効かない(= dist ゲートはこの種の劣化を検出できない) | VERIFIED | 下記ラボ実測(TTFB 0ms では main の成果物も本ブランチの成果物も FCP がほぼ同じ) |
| A-4: `tools/lh-slow-server.mjs` の遅延が Lighthouse に TTFB として観測される | VERIFIED | `KUSAKUZUSHI_LH_TARGET=slow` で実行し `server-response-time: 175ms`(表示 "Root document took 170 ms")、ルート文書の wall clock 2→180ms を実測 |
| A-5: Google Fonts の CSS はセッション9 で非ブロッキング化済みで FCP の鎖に乗っていない | VERIFIED | 本番の `render-blocking-resources` が 1 件(自前 CSS)のみ。index.html の `media="print"` + `onload` |
| A-6: フォントの自前ホスト化は FCP を直接動かさない | VERIFIED(前提が実測) | A-5 より、フォントは render-blocking ではない。効くとすればシミュレーション帯域の取り合いのみで、クリティカルパスの往復は減らない |
| A-7: このサンドボックスからは本番 URL を計測できない | VERIFIED | egress ポリシーで `kusakuzushi.toshi0607.com:443` への CONNECT が 403(agent proxy の status に記録) |
| A-8: このサンドボックスの Chrome は fonts.googleapis.com へ到達できない | VERIFIED | ラボの network-requests で当該 2 件が statusCode -1。curl は到達できるが Chrome は ERR_CONNECTION_RESET |
| A-9: CI(ubuntu-latest)では `slow` ターゲットも dist と同様に走る | UNVERIFIED-ACCEPTED(2026-07-25) | dist ジョブが同じランナーの Chrome で動いている実績(セッション9)。`slow` は配信元が lhci 内蔵サーバから `tools/lh-slow-server.mjs` に変わるだけで Chrome の要件は同じ。**この PR の CI が初回検証** |
| A-10: `slow` のしきい値(共通の 1800/2500)は CI 上でも通る | UNVERIFIED-ACCEPTED(2026-07-25) | ローカルラボはフォントを取得できないぶん楽観的な数字になる。CI ではフォント取得が帯域を食うので悪化しうる。**この PR の CI で校正する** |
| A-11: 本番デプロイ後に `pnpm lh:prod` が緑になる | **VERIFIED**(2026-07-25、デプロイ後) | デプロイ(`0663da25`)後に `Lighthouse` ワークフローを workflow_dispatch で実行(run 30161863485)→ `production` ジョブ **success**。中央値 perf 99 / FCP 1013ms / LCP 2005ms / CLS 0.0064 / render-blocking 0 件 |

### 打ち手の比較(依頼の 1/2/3 + 実測から出てきた 4)

| # | 打ち手 | FCP の鎖への効き方 | コスト | 判断 |
|---|---|---|---|---|
| 1 | Web フォントの自前ホスト化 | **無し**。フォント CSS は既に非ブロッキングで鎖に乗っていない(A-5/A-6)。効くのはシミュレーション帯域の取り合いだけ | 大。IBM Plex Sans JP は日本語で、Google が unicode-range で 100 以上のサブセットに割っている。全部持つとリポジトリが MB 級に膨らみ、絞ると「サブセットに無い文字が system-ui に落ちる」壊れ方をする(本文フォントなので入力値も通る) | **見送り**。効かないものに一番大きなコストを払うことになる |
| 2 | 自前 CSS(5KB)のインライン化 | **1 往復ぶん**。残る唯一の render-blocking を消す | 小。Vite の生成物を書き換える 20 行のプラグインで済み、新規依存ゼロ | **採用**。セッション9 で見送った理由(「新規依存が要る / 既に 100 点」)は両方とも成り立たない |
| 3 | production 用のしきい値を別建て | 指標を動かさない(見え方だけ変える) | 小 | **不採用**。1800/2500 は CWV の "good" 境界であって dist 由来ではない(A-2)。緩めると「本番では何 ms でもよい」という意味になる。**代わりに退行検知の側を足した**(打ち手 5) |
| 4 | ページシェルを静的 HTML に出す | **JS を鎖から外す**。FCP/LCP がバンドルのダウンロードと実行を待たなくなる | 中。`buildShell()` を index.html の markup に移し、`.stage` に高さを確保して CLS を防ぐ | **採用**。真因への直接の対処で、効き幅が一番大きい |
| 5 | `slow` ターゲット(TTFB 170ms を注入した dist)を PR ゲートに追加 | 指標を動かさない(退行を検知する) | 小。60 行のサーバ + lhci のターゲット追加 + CI ジョブ 1 つ | **採用**。ただし「唯一の仕組み」ではない — ランナーのばらつきのせいで往復 1 回を捕まえるほど締められないことが後で分かり、決定的な保証は `shell.test.ts` に置いた(下記「退行検知の設計」) |

### ラボ実測: どの変更が FCP のどこを削ったか(2026-07-25)

本番 URL はこのサンドボックスの egress ポリシーで計測できない(A-7)ので、
**同じ成果物を TTFB 170ms のサーバから配信して**切り分けた。170ms は本番の
`server-response-time` 実測値。フォント CSS の `<link>` は 4 バリアントとも
取り除いてある(このサンドボックスの Chrome は fonts.googleapis.com に届かず
12.8s ハングして Lantern の帯域推定を汚すため)。Lighthouse 12 / mobile / 3 runs 中央値。

| TTFB | バリアント | perf | FCP | LCP | render-blocking |
|---|---|---|---|---|---|
| 0ms | A: main の成果物 | 100 | 1077 | 1227 | 1 |
| 0ms | D: 本ブランチ | 100 | 909 | 922 | 0 |
| 170ms | A: main の成果物 | 100 | **1394** | 1544 | 1 |
| 170ms | B: CSS インライン化のみ | 100 | 1246 | 1273 | 0 |
| 170ms | C: 静的シェルのみ | 99 | **1396** | 1546 | 1 |
| 170ms | D: 両方(本ブランチ) | 100 | **814** | 814 | 0 |

読み取れること:

1. **どちらか片方では効かない。** 静的シェルだけ(C)は main(A)と同じ 1396ms —
   DOM が静的でも、外部 CSS が render-blocking である限り FCP はその往復を待つ。
   CSS インライン化だけ(B)は 1246ms — CSS の往復は消えるが、中身を作る JS の往復が残る。
   **両方外して初めて FCP が「HTML だけ」になり 814ms に落ちる**(A 比 -580ms / -42%)。
   当初「静的シェルが主因への直接の対処で効き幅が一番大きい」と書いたが、これは誤り
   だった(打ち手の比較表の記述をこの実測で上書きする)。
2. **dist(TTFB 0)ではこの差が 1/3 に潰れる。** A と D の差は TTFB 0 で 168ms、
   TTFB 170 で 580ms。localhost 配信は往復コストをほぼゼロにするので、
   往復が 1 回増える種類の劣化を過小評価する。dist ゲートが 2 セッション見逃した理由。
3. **`slow` ゲートは万能ではない。** TTFB 170ms・フォント無しの条件では
   main(A)も FCP 1394ms で共通しきい値 1800ms を通ってしまう。
   ラボは本番より条件が甘い(TLS 無し / HTTP/1.1 / localhost / クロスオリジンのフォント取得無し)。
   → **`slow` にはターゲット固有の厳しいしきい値を別途置く**(下記)。

### 実測できなかったこと(このセッションの限界)

| 項目 | 理由 | 代わりにやったこと |
|---|---|---|
| 本番 URL(`pnpm lh:prod`)の再計測 | egress ポリシーで `kusakuzushi.toshi0607.com:443` への CONNECT が 403(A-7) | ラボ + CI。デプロイ後にワークフローを workflow_dispatch で回して確認すること |
| フォント取得を含む条件での比較 | サンドボックスの Chrome が fonts.googleapis.com に到達できない(A-8) | フォント無しで統一して比較。フォントは render-blocking ではないので FCP の鎖には乗らない(A-5) |
| `--throttling-method=provided` / desktop preset との突き合わせ | 上と同じ理由で本番を測れない。localhost に対して provided で測っても「ネットワークが速い」以上の情報が出ない | 依頼の分岐点への回答は、しきい値の出どころ(CWV の "good" 境界)とラボの切り分けで組み立てた |
| 実ユーザーのフィールド値(CrUX) | 個人規模のサイトは CrUX の収集閾値に届かない見込み | ラボのモバイル値を設計目標として扱う判断を明記(冒頭) |

### 退行検知の設計(しきい値は締めない/不変条件をテストで書く)

`slow` を足したあと、「往復が 1 回増えたら赤くなる」ところまでしきい値を締めようとしたが、
**CI の実測ばらつきがそれを許さない**。本 PR の `slow` ジョブ(修正後・3 runs)の実測:

```
perf     100   [81, 100, 100]
FCP      900   [1857, 900, 827]
LCP     1554   [2147, 1554, 827]
TBT       58   [659, 58, 0]
CLS   0.0071   [0.023, 0.0067, 0.0071]
TTFB     173   [176, 173, 172]
blocking   0   [0, 0, 0]
```

FCP が 827〜1857ms(2.2 倍)。GitHub の共有ランナーではこの程度は普通に出る。
往復 1 回ぶん(ラボで 148〜432ms)を捕まえられる厳しさにすると、
**壊れていないのに落ちるゲート**になり、じきに誰も見なくなる。

そこで役割を分けた:

| 何を守るか | どこで | 決定的か |
|---|---|---|
| 最初の描画が JS を待たない | `apps/web/src/shell.test.ts`(`index.html` の中身を直接検査) | **決定的**。ばらつきゼロ・数 ms |
| render-blocking が増えていない | lhci `render-blocking-resources: 0`(dist / slow / production) | 決定的(件数なので回線に依存しない) |
| JS が肥大化していない | lhci `resource-summary:script:size` | 決定的 |
| 総合的な劣化(粗い網) | lhci のカテゴリ + CWV しきい値(3 ターゲット共通) | ばらつきあり。中央値で緩和 |
| 実物の健康診断 | `production` ジョブ(毎日 06:00 JST) | ばらつき大。ここが最終的な事実 |

`shell.test.ts` はネガティブテスト済み: `#app` を空に戻すと 3 件とも落ちることを実測してから戻した。

**`slow` の限界を明記しておく**: ラボ実測のとおり、TTFB 170ms・フォント無しの条件では
main の成果物(FCP 1394ms)も共通しきい値 1800ms を通る。`slow` は本番の条件
(TLS / HTTP/2 / クロスオリジンのフォント取得)を再現していないぶん甘い。
**`slow` は「dist より本番に近い粗い網」であって、本番の代わりではない。**
この種の劣化を確実に止めるのは上の表の 1 行目(不変条件のテスト)。

### タスク

- [x] 真因の特定(コード読解): `#app` が空 + `buildShell()` で FCP/LCP が JS 待ち
- [x] 打ち手の比較(依頼の 1/2/3 + 実測から出た 4/5)。フォント自前ホスト化は不採用、しきい値の別建ても不採用
- [x] シェルを `index.html` の静的マークアップへ(`app.ts` は `findStage` で拾うだけ)
- [x] 自前 CSS のインライン化(`vite.config.ts` に 20 行のプラグイン、新規依存 0)
- [x] `.stage` の高さ確保で CLS 回帰を解消 — CI 実測 0.0995 → 0.0071
- [x] `slow` ターゲット + `tools/lh-slow-server.mjs` + CI ジョブ。`server-response-time 175ms` を実測して遅延が効いていることを確認
- [x] `tools/lh-summary.mjs`(緑でも実測値をログに残す)
- [x] `shell.test.ts`(最初の描画が JS を待たないことの不変条件テスト)。ネガティブテスト済み
- [x] `pnpm -r test` 全 pass(web 28 → 31 件)/ `pnpm -r build` exit 0
- [x] CI: `test` / `Lighthouse / dist` / `Lighthouse / slow` すべて green、`production` は PR で skip
- [x] マージ → `wrangler pages deploy` → `Lighthouse` ワークフローを workflow_dispatch で回して本番を再計測
  - マージ e7aab07 → デプロイ `0663da25` → workflow run 30161863485 の `production` ジョブ **success**
  - 中央値 perf **99** / FCP **1013ms** / LCP **2005ms** / TBT 0 / CLS 0.0064 / render-blocking **0 件**(3 runs: FCP [2175, 1013, 994])
  - セッション9 が残し、セッション10 で「green にならない」と記録した宿題は、これで **解消**(当時 perf 76 / FCP 4.1s)

### デプロイ時に踏んだこと(次回のため)

- **デプロイ直後の `pnpm lh:prod` は当てにならない。** 3 runs が旧ビルドと新ビルドを混ぜて引く。
  判別は成果物のハッシュ名: run 1 が `index-BpMi0tfA.js`(新・CSS インライン・HTML 5616B)で perf 100 / FCP 1188ms、
  run 2 が `index-pr2ZC311.js` + `index-Cu7t7aJQ.css`(旧・HTML 3116B)で perf 76 / FCP 3857ms だった。
  `curl` で HTML を数回引いて全部が新ハッシュを指すのを確認してから測ること
- **伝播後も、ローカル回線からの `pnpm lh:prod` はばらつく。** 全 run が新バンドル・blocking 0 でも
  FCP は 1153 / 3767 / 2729ms と揺れ、中央値がしきい値を超えた。同時刻に CI(GitHub ランナー)から
  測ると FCP 中央値 1013ms で green。**本番の合否判定はローカルではなく CI の `production` ジョブで行うこと**
- 次の一手(**発動せず**。A-11 で本番 green を実測したため前提が消えた。将来また赤くなったとき用に残す): `production` ジョブのログ(`lh-summary`)で FCP の内訳を見る。残るクリティカルパスは HTML 1 往復だけなので、次に効くのは Cloudflare 側(`server-response-time` 170ms)か、フォント取得が帯域を食っている分(その場合は初めて自前ホスト化に意味が出る)

## セッション13: Chrome ウェブストア公開(進行中 2026-07-26)

拡張(apps/extension)を Chrome ウェブストアに出す。本体は完成済み(build/test green)なので、
このセッションの作業は **ストア提出物の作成** と **デベロッパーコンソールへの入力**。

### ユーザー決定(2026-07-26)

| 論点 | 決定 |
|---|---|
| 公開範囲 | **テスター限定 (Private)** — まず自分だけで動作確認。後から Unlisted/Public に変更可 |
| 掲載文の言語 | **日本語 + 英語**(既定 en + ja ロケール) |
| プライバシーポリシー | **用意する** — apps/web に `/privacy` を追加してデプロイ |

### Constraints

| Constraint | Source | Verify by |
|------------|--------|-----------|
| デベロッパー登録・$5 決済はユーザーが行う | システム規約(アカウント作成・決済情報入力は禁止) | ユーザー報告 |
| 「審査に送信」の最終クリックはユーザー | システム規約(公開行為) | ユーザー報告 |
| 未パック拡張の読み込みはユーザー | `chrome://` はブラウザ自動化の対象外 | ユーザー報告 |
| 拡張は権限ゼロ・リモートコード無しを維持 | 審査摩擦の最小化 | manifest の permissions が空、dist に外部 URL の import が無いこと |
| 拡張の挙動は変えない | 今回は公開作業であって機能変更ではない | `pnpm --filter @kusakuzushi/extension test` 49 pass |

### Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| 登録料は $5(1回・返金不可・アカウント単位) | VERIFIED | developer.chrome.com/docs/webstore/register(2026-07-26 取得) |
| 必須画像はストアアイコン128x128・スクショ1280x800(最低1枚)・小プロモタイル440x280 | VERIFIED | developer.chrome.com/docs/webstore/images(2026-07-26 取得) |
| 掲載文のロケール追加には拡張が `_locales` でそのロケールを持つ必要がある | UNVERIFIED-ACCEPTED(2026-07-26) | **外形検証が不可能**: 確かめる場所がデベロッパーコンソールの掲載情報タブしかなく、そこはユーザーのアカウント(登録・$5 決済が前提、A-1 が未完)。緩和策として `_locales/{en,ja}` は既に入れてあるので、必要だった場合でも詰まらない。不要だった場合の損は「使われないロケールファイルが2 つある」だけ。C-1 のコンソール入力時に判明する |
| データ収集ゼロならプライバシーポリシー URL は必須でない | UNVERIFIED-ACCEPTED(2026-07-26) | docs に明記が無い。**緩和策として /privacy を先に用意する**ので、必須であっても詰まらない |
| Cloudflare Pages は `public/privacy/index.html` を `/privacy` で配信する | **VERIFIED**(2026-07-26、セッション14 が実測) | `/privacy` は **308** で `/privacy/` へ、`/privacy/` が **200**。本文の sha256 は `2a8b2baf…` で手元の `dist/privacy/index.html` と一致。ルートの `index.html`(`ee82bf83…`)とは別物なので、Pages の「存在しないパスに index.html を 200」ではない。**B-8 の完了条件は満たされている** |

### Phase A: ユーザー作業(エージェント不可)

- [ ] A-1. Chrome ウェブストア デベロッパー登録 + $5 支払い — https://chrome.google.com/webstore/devconsole
- [ ] A-2. Account タブで連絡先メールを確認済みにする(未確認だと提出できない)
- [ ] A-3. Private 配布用に「信頼できるテスター」に自分の Google アカウントを追加
- [ ] A-4. `chrome://extensions` → デベロッパーモード ON → `apps/extension/dist` を読み込む(スクショ撮影の前提)
- [ ] A-5. 最終「審査に送信」クリック

### Phase B: エージェントが用意する提出物

- [x] B-1. manifest 仕上げ: version 1.0.0 / `homepage_url` / `default_locale` + `_locales/{en,ja}` — `pnpm -r build` exit 0、`pnpm -r test` 225 pass
- [x] B-2. `_locales` を dist に写す(build.mjs)。ついでに毎回 dist を作り直して古い生成物を残さない
- [x] B-3. zip パッケージ生成スクリプト `pnpm --filter @kusakuzushi/extension package` — `unzip -l` でルートに manifest.json / content.js / icons/ / _locales/ の 12 entries を実測
- [x] B-4. 小プロモタイル 440x280 PNG — `apps/extension/store/promo-tile-440x280.png`(440x280 を `file` で実測)。生成元は `apps/web/tools/promo-tile.{html,ts}` + dev エンドポイント `/__save-card?target=promo-tile`
- [ ] B-5. スクリーンショット 1280x800 を最大5枚(A-4 の後、claude-in-chrome で本物の GitHub プロフィールを撮影 → 整形)
- [x] B-6. 掲載文(詳細説明 ja/en・カテゴリ・言語) — `apps/extension/store/listing.md`
- [x] B-7. プライバシータブ回答文 — `store/listing.md` §4。データ収集ゼロは grep で実測(src に fetch/storage/chrome. の参照なし、dist/content.js に http(s) URL が 0 件)
- [~] B-8. `/privacy` ページ作成済み(`apps/web/public/privacy/index.html`、dev サーバーで表示確認)。**デプロイはユーザー承認待ち** — `curl -sI https://kusakuzushi.toshi0607.com/privacy` が 200 になったら完了
- [x] B-9. `apps/extension/README.md` に公開手順を追記

### Phase C: 一緒に実施

- [ ] C-1. デベロッパーコンソールへブラウザ操作で入力(zip アップロード・掲載文・画像・プライバシー・配布範囲)
- [ ] C-2. ユーザーが最終送信 → 審査結果を待つ

### 見送り(スコープ外・要green)

- 拡張 UI 文言(「🎮 崩す」ほか 6 文字列)の i18n。今回は manifest の name/description のみ英語化する。
  UI まで英語化するかは別途判断(content.ts に `chrome.i18n` が入ると jsdom テストにモックが要る)

## セッション14: PR マージで自動デプロイ + パブリック化の準備(2026-07-26)

依頼: 「PR マージでデプロイされるようにしたい。ゆくゆくはパブリックリポジトリにするので、それも踏まえて」

### なぜやるか

セッション12 まで、デプロイは毎回人間が `wrangler` を叩いていた。その手動運用が実際に事故を生んでいる:

- **S6**: デプロイ後に本番が真っ白。切り分けで「origin の実体は手元の dist と byte 一致か」を
  `curl` + `shasum` で手作業確認した
- **S12**: デプロイ直後の計測が旧ビルドと新ビルドを混ぜて引いた。判別はアセットのハッシュ名の目視
  (`index-BpMi0tfA.js` か `index-pr2ZC311.js` か)
- **S10(アイテムドロップ)**: 「ブランチ作成後に main へ入った別 PR の機能もこの配信に含まれる」—
  どの時点の main が本番かが人間の記憶に依存していた

いずれも「配信中の成果物 == 手元の成果物」が機械で言えれば消える手間。あわせて `npx wrangler` の
浮動バージョン(実行時の latest)も固定する。

### Constraints(セッション14)

| Constraint | Source | Verify by |
|---|---|---|
| デプロイ対象は apps/web(Pages)と workers/ogp(Worker)の両方。変更パスで出し分け | ユーザー選択 2026-07-26 | `changes` ジョブのログ |
| デプロイのゲートは `ci.yml` の `test` のみ。Lighthouse は待たせない | ユーザー選択 2026-07-26 | `deploy-*` の `needs` |
| 既存の `test` / `Lighthouse` ジョブの挙動を変えない | 既存 CI が退行ゲート | `lighthouserc.cjs` の diff が空、3 ジョブが従来どおり green |
| デプロイは main への push のみ。fork PR から絶対に走らない | パブリック化前提 | `deploy-*` の `if` 条件 + PR でスキップされる実測 |
| 新規のランタイム依存を増やさない | リポジトリの既存方針(`tools/*.mjs` は依存ゼロ) | 追加は devDependency の `wrangler` だけ。verify 系は Node 標準 API のみ |
| クレデンシャルは Claude が扱わない | 安全ルール | トークン作成と secret 登録はユーザーが実施 |
| LICENSE / README は今回入れない | ユーザー選択(公開の意思決定が要るため別 PR) | — |

### Assumptions(セッション14)

| Assumption | Status | Evidence |
|---|---|---|
| コミット履歴にクレデンシャルは含まれない | VERIFIED | 追加された全ファイルを列挙して確認、`git grep` でトークン様の文字列 0 件 |
| `workers/ogp` は `packages/core` に依存しない(core 変更で Worker を出し直す必要が無い) | VERIFIED | `workers/ogp/package.json` の deps は `workers-og` のみ |
| wrangler 4.114.0 で Worker がバンドルできる | VERIFIED | `wrangler deploy --dry-run` が Total Upload 1974.86 KiB で成功(2026-07-26) |
| `pnpm install` が build script を無視しても wrangler は動く | VERIFIED | `pnpm exec wrangler --version` → 4.114.0、上記 dry-run も成功。workerd の postinstall は `wrangler dev` 用で deploy には要らない |
| `verify-deploy.mjs` は壊れたら実際に赤くなる | VERIFIED | ネガティブテスト4種(別アセット / 中身切り詰め / robots.txt 差し替え / 到達不能ホスト)で exit 1 を実測(下記) |
| `verify-worker.mjs` は route が外れたら赤くなる | VERIFIED | route の無い `kusakuzushi.pages.dev` に向けると「人間 UA が 200」で exit 1(2026-07-26) |
| API トークン(Pages Edit + Workers Scripts Edit + Workers Routes Edit)で両方のデプロイが通る | **VERIFIED**(2026-07-26) | 初回自動デプロイ(run 30188384802)で `deploy-web` / `deploy-ogp` とも success。テンプレート「Edit Cloudflare Workers」+ `Cloudflare Pages: Edit` で足りた |
| private のままブランチ保護が設定できる(GitHub のプラン依存) | **VERIFIED**(2026-07-26) | `gh api -X PUT repos/toshi0607/kusakuzushi/branches/main/protection` が成功し、`required_status_checks.contexts = [test, dist, slow]` / `allow_force_pushes: false` / `allow_deletions: false` が設定された。**private のままで張れる** |

### main とのマージ(2026-07-26)

PR を出した後に main が進んでいたため(PR #30「Chrome ウェブストア公開」)、CI が
**コンフリクト状態のワークフローを起動できず**、チェックが 1 つも走らない状態になっていた。
`origin/main` をマージして解消。ぶつかったのは `tasks/todo.md` のみ。

- **セッション番号の衝突**: 並行セッションが先に 13 を使っていたので、こちらを **14** に振り直した
  (8 / 10 と違って相互参照が増える前だったため、索引で引かせるのではなく振り直せた)
- main 側が追加した `apps/web/public/privacy/index.html` により dist が 7 → 8 ファイルになった。
  `verify-deploy.mjs` は `*/index.html` をディレクトリ URL(`/privacy/`)として照合するよう修正
- `/privacy/` は**既に本番へデプロイ済み**だった(セッション13 の B-8)。実測: 本番 `/privacy/` の
  sha256 が手元の `dist/privacy/index.html` と一致(`2a8b2baf…`)。ルートの index.html
  (`ee82bf83…`)とは別物なので、Pages の「存在しないパスに index.html」ではない

### 変えたもの

| ファイル | 内容 |
|---|---|
| `apps/web/package.json` / `workers/ogp/package.json` | devDependency に `wrangler@^4`、`deploy` スクリプトを追加。`npx wrangler`(浮動)をやめ、pnpm-lock で固定する |
| `package.json`(ルート) | `deploy:web` / `deploy:ogp` / `verify:web` / `verify:ogp` |
| `.github/workflows/ci.yml` | `test` に artifact upload、`changes`(パス判定)、`deploy-web`、`deploy-ogp` を追加。`permissions: contents: read`、`concurrency`、action の SHA 固定 |
| `.github/workflows/lighthouse.yml` | `permissions: contents: read`、`pnpm/action-setup` を SHA 固定 |
| `.github/dependabot.yml`(新規) | github-actions と npm の週次更新。wrangler は単独 PR |
| `tools/verify-deploy.mjs`(新規) | Pages のスモーク。本番 HTML が今回のエントリ JS を指し、その sha256 が手元と一致するまでリトライ |
| `tools/verify-worker.mjs`(新規) | Worker のスモーク。人間 UA→302 / クローラー UA→200+og:image / og.png→image/png |

`deploy` スクリプトを叩くときは **`pnpm run` が要る** — `pnpm deploy` は pnpm 組み込みのコマンドで、
`pnpm --filter X deploy` はスクリプトを実行しない。

### 設計上の判断

- **デプロイするのは test ジョブが上げた artifact**。deploy ジョブで build し直すと
  「本番の中身 == テストしたもの」が状況証拠にしかならない。S6/S12 の切り分けコストはそこに由来した
- **Lighthouse は待たせない**。`dist` / `slow` は PR で必ず走るゲートで、main に入る時点で通過済み。
  ワークフローをまたぐ依存(`workflow_run`)は checkout する ref の指定を間違えやすく、
  得られる保証に対して配線が重い
- **paths-filter アクションを使わず `git diff` で判定**。パブリックリポジトリに増やす依存を減らす。
  `github.event.before` を辿れないとき(force push / 初回 push)は**両方 true にフォールバック**する
- **自動ロールバックは入れない**。スモークの誤検知でロールバックするほうが危険。
  スモークが赤いときは人間が Cloudflare ダッシュボード / `wrangler pages deployment` で判断する
- **サードパーティ action は SHA 固定、`actions/*` はメジャータグ**。前者はタグを書き換えられるため。
  固定しっぱなしにしないために Dependabot を同時に入れた
- **`pull_request_target` は使わない**。fork の PR コードを secret 付きで走らせる唯一の穴

### account ID / zone ID の扱い

`workers/ogp/wrangler.toml` の `zone_id` と、この todo.md にある Account ID
(`5ee49b8e0983dc8fcf6d0eddb45ef5d8`)は**クレデンシャルではなく識別子**で、API トークン無しでは
何もできない。よって**履歴の書き換えはしない**。

当初は `CLOUDFLARE_ACCOUNT_ID` も GitHub secret に置く予定だったが、レビュー(L4)を受けて
**ワークフローに平文で置く**ことにした。secret にすると GitHub がその文字列をログ全体でマスクし、
`wrangler` の出力が `***` だらけになって切り分けの邪魔になる。秘匿する必要が無いものを
secret にすると、得るものが無いのに読みにくさだけが増える。

### 新しい運用

- **通常**: main へマージすると `CI` が回り、変更パスに応じて `deploy-web` / `deploy-ogp` が走る。
  デプロイ後にスモークが自動で通る。手でコマンドを叩く必要は無い
- **手元から出したいとき**(緊急時):

```bash
pnpm -r build
pnpm run deploy:web && pnpm run verify:web
pnpm run deploy:ogp && pnpm run verify:ogp
```

- **本番の健康診断**: 従来どおり `Lighthouse` ワークフローの `production` ジョブ(毎日 06:00 JST /
  `workflow_dispatch`)。ローカルからの `pnpm lh:prod` はばらつくので合否判定に使わない(S12)

### ユーザー作業(Claude は触らない)

1. Cloudflare ダッシュボードで API トークンを作成。テンプレート「Edit Cloudflare Workers」をベースに、
   - Account → **Cloudflare Pages : Edit**
   - Account → **Workers Scripts : Edit**
   - Zone → **Workers Routes : Edit**(`wrangler.toml` の `routes` を張り直すのに要る)
   - Account Resources: 当該アカウントのみ / Zone Resources: `toshi0607.com` のみ
2. GitHub の repo secrets に **`CLOUDFLARE_API_TOKEN`** を登録(これ 1 つだけ)。
   account ID はワークフローに平文で置いてある(レビュー L4 の対応。識別子であって
   クレデンシャルではなく、secret にするとログでマスクされて切り分けの邪魔になる)

**secret が無いと `deploy-*` は落ちる**(ワークフローは動くがデプロイが失敗する)。
しかもこの PR 自身が `pnpm-lock.yaml` / `package.json` / `ci.yml` を触るので、
マージ時の push は必ず両方のデプロイを起動する(レビュー M1)。**マージ前に登録しておくこと。**

### タスク

- [x] `wrangler` を devDependency として固定 + `deploy` スクリプト
- [x] `tools/verify-deploy.mjs`(Pages スモーク)。ネガティブテスト2種で exit 1 を実測
- [x] `tools/verify-worker.mjs`(Worker スモーク)。route の無いオリジンで exit 1 を実測
- [x] `ci.yml` に `changes` / `deploy-web` / `deploy-ogp`、artifact の受け渡し
- [x] `permissions` / SHA 固定 / `concurrency` / `dependabot.yml`
- [x] `pnpm -r test`(162件)/ `pnpm -r build` exit 0
- [x] ユーザーが Cloudflare API トークンを作成し、`CLOUDFLARE_API_TOKEN` として登録(2026-07-26 04:47Z)
- [x] PR → CI green(`deploy-*` が PR でスキップされることを確認)— https://github.com/toshi0607/kusakuzushi/pull/32 で `test` pass 37s / `Lighthouse dist` pass / `Lighthouse slow` pass、`changes` / `deploy-web` / `deploy-ogp` / `production` はすべて **skipping**(2026-07-26)。**門番条件が効いていることの実測**
- [x] マージ → `deploy-web` / `deploy-ogp` が成功しスモークが緑 — 下記「初回自動デプロイ」
- [x] ブランチ保護(main)— PR 必須 / required checks = `test` `dist` `slow` / force push・削除禁止 / 承認レビュー 0 人(1人メンテなので自分でマージできる)。`strict: false`(ブランチを最新に保つ強制はしない)
- [ ] fork PR のワークフロー承認必須化 — **private では設定不可**。`gh api .../actions/permissions/fork-pr-contributor-approval` が 422 `Fork PR approval is not allowed for private repositories.`。**パブリック化時に実施**
- [ ] Secret scanning + push protection — **private では利用不可**。`PATCH /repos/...` が 422 `Secret scanning is not available for this repository.`(private は GitHub Advanced Security が要る)。**パブリック化すれば無料で使えるのでそのとき実施**
- [x] パス判定の**陰性側**を本番の main で実測 — PR #35(`tasks/todo.md` のみ)のマージ(`27d3c29`、run 30189189953)で `変更ファイル: tasks/todo.md` → **`web=false ogp=false`**、`deploy-web` / `deploy-ogp` とも **skipped**
- [ ] パス判定の**選択側**(`workers/ogp` だけ触ったとき `deploy-web` だけスキップ)— 検証のためだけに Worker を触るのは本末転倒なので、**次に Worker を変更する PR で自然に確認する**。ロジック自体は 11 ケースのローカル実行で確認済み

### 検証結果(2026-07-26、PR 段階)

パス判定ロジック(`changes` ジョブと同じスクリプト)を代表的な変更セットで実行:

```
web のみ            : web=true  ogp=false
worker のみ         : web=false ogp=true
core のみ           : web=true  ogp=false      # ogp は core に依存しない
lockfile            : web=true  ogp=true
docs のみ           : web=false ogp=false
extension のみ      : web=false ogp=false      # 拡張はデプロイ対象外
lighthouse.yml のみ : web=false ogp=false
空                  : web=false ogp=false
```

`verify-deploy.mjs`(本番 https://kusakuzushi.toshi0607.com/ に対して):

```
正常   : 期待 /assets/index-SQEC_6xV.js / sha256 14a678da… → 1 回目で一致、exit 0
異常1  : HTML が別アセットを指す        → 「本番 HTML がまだ …-SQEC_6xV.js を指している」exit 1
異常2  : 名前一致・中身が切り詰め(1535B)→ 「sha256 不一致(配信 27756B、手元 1535B)」exit 1
```

異常2 は S6 の白画面(切り詰められた JS はパースが通り、console エラーを出さずに何もしない)の形。
**名前の一致だけでは中身を保証できない**ので、sha256 まで見る設計にしてある。

`verify-worker.mjs`:

```
正常 : 人間 UA → 302 / クローラー UA → 200 + og:image / og.png → image/png、exit 0
異常 : route の無い kusakuzushi.pages.dev → 「人間 UA が 200(302 のはず。200 なら route が外れている)」exit 1
```

異常側が意味を持つのは、Pages が**存在しないパスに index.html を 200 で返す**から(S9 の robots.txt)。
つまり `/share/*` が 200 であることは route の証明にならず、302 であることが証明になる。

### CI 実測(PR 段階、2026-07-26)

```
test        pass     37s
dist        pass              (Lighthouse)
slow        pass              (Lighthouse)
changes     skipping          github.event_name == 'push' でないため
deploy-web  skipping          needs: changes がスキップ + if 条件
deploy-ogp  skipping          同上
production  skipping          schedule / workflow_dispatch のみ
```

**PR がコンフリクトしているとチェックが 1 件も走らない。** マージ ref を計算できないと
GitHub は `pull_request` のワークフローを起動しない。「CI が緑」ではなく「CI が無い」状態は
一見すると同じに見える(`gh pr checks` は "no checks reported" としか言わない)ので、
**チェックが 0 件のときは緑ではなくコンフリクトを疑うこと**。

### リポジトリ設定(2026-07-26 実施)

| 設定 | 結果 |
|---|---|
| main のブランチ保護 | **適用済み**。PR 必須 / required checks = `test` `dist` `slow` / force push・削除禁止 / 承認レビュー 0 人。`strict: false` にしてあるので「main が進むたび再ビルド待ち」にはならない |
| fork PR のワークフロー承認必須化 | **private では設定できない**(API が 422 で明示的に拒否)。パブリック化時に実施 |
| Secret scanning + push protection | **private では利用できない**(GitHub Advanced Security が要る)。パブリック化すれば無料 |

つまり**公開に向けた残りのリポジトリ設定は 2 つだけ**で、どちらも public にした直後に入れる。
コード側(ワークフローの `permissions` / SHA 固定 / `pull_request_target` 不使用 / deploy の門番)は
今回で完了している。

### 初回自動デプロイ(2026-07-26、run 30188384802)

PR #32 をマージ(`5b4dd96`)→ **全ジョブ success**。所要 約1分20秒。

```
changes     success   → web=true ogp=true      (pnpm-lock.yaml / package.json / ci.yml が shared に当たる)
test        success
deploy-web  success   ✨ Uploaded 0 files (8 already uploaded) → f247cffc
                      ✅ 8 件すべて sha256 一致(1 回目)
deploy-ogp  success   Total Upload 1974.86 KiB / Version ID b4cd4597-9965-41ee-8324-4438120bef02
                      ✅ 人間 UA → 302 / クローラー UA → 200 + og:image / og.png → image/png
```

読み取れること:

- **トークンのスコープは足りていた。** 「Edit Cloudflare Workers」テンプレート + `Cloudflare Pages: Edit` で
  Pages と Worker の両方が通った(Assumptions の当該行を VERIFIED に更新)
- **`Uploaded 0 files (8 already uploaded)`** — 中身が既存デプロイと同一だったため実アップロードは 0 件。
  それでも新しいデプロイ(`f247cffc`)は作られ、verify は 8 件すべて一致を確認した
- **スモークは 1 回目で通った。** エッジ伝播のリトライは今回は使われていない。
  ただしこれは「毎回そうなる」という意味ではない(S12 の実測では旧/新が混ざる時間帯があった)

#### レビュー L8(未確認だった項目)の決着

**VERIFIED**: `wrangler pages deploy` は CI 上の `.git` からコミットを自動検出していた。
`wrangler pages deployment list --project-name kusakuzushi` の **Source 列が `5b4dd96`**
(= マージコミット)。ダッシュボードからも同じものが引ける。

これでセッション10 の動機(「どの時点の main が本番か」が人間の記憶に依存していた)は
**完全に解消**した。本番の実体 → デプロイ ID → コミット の 3 つが機械で辿れる。

### パス判定の実測(main、2026-07-26)

| マージ | 変更ファイル | 判定 | デプロイ |
|---|---|---|---|
| PR #32(`5b4dd96`) | `pnpm-lock.yaml` / `package.json` / `ci.yml` ほか | `web=true ogp=true` | 両方 success |
| PR #35(`27d3c29`) | `tasks/todo.md` のみ | `web=false ogp=false` | 両方 **skipped** |

両端が実測できたので、`changes` ジョブは意図どおり動いている。
残るのは選択側(片方だけ)で、これは**次に Worker を触る PR で自然に確認する** —
検証のためだけに本番コードへ変更を入れるのは本末転倒。

### セッション14 の完了状態

| 項目 | 状態 |
|---|---|
| main へのマージで自動デプロイ | **稼働中**(初回 run 30188384802 で両方 success) |
| デプロイ後スモーク(Pages 全 8 ファイルの sha256 / Worker の 3 分岐) | **稼働中**。ネガティブテスト 5 種で赤くなることを実測済み |
| パス判定 | **稼働中**。両端を main で実測 |
| wrangler のバージョン固定 | 完了(devDependency + pnpm-lock) |
| 公開耐性(permissions / SHA 固定 / pull_request_target 不使用 / 門番条件) | 完了 |
| ブランチ保護 | 適用済み(required checks = `test` `dist` `slow`) |
| fork PR のワークフロー承認必須化 | **public 化時**(private では API が拒否) |
| Secret scanning + push protection | **public 化時**(private では GHAS が要る) |
| LICENSE / ルート README / SECURITY.md | **別 PR**(公開の意思決定が要る) |
| Dependabot が pnpm workspace 配下の wrangler を辿るか(レビュー L9) | 週次実行待ち |

### 今回やらないこと

| 項目 | 理由 |
|---|---|
| LICENSE / ルート README / SECURITY.md | 公開の意思決定(ライセンス選択、対外的な説明)が要るので別 PR |
| Cloudflare Pages の Git 連携(Pages 側でビルド) | direct upload を維持。monorepo + pnpm のビルド設定を Pages 側に二重管理したくない |
| プレビューデプロイ(PR ごとの `--branch` デプロイ) | 今回のスコープ外。PR の品質担保は Lighthouse の `slow` ゲートが担っている |
| 自動ロールバック | 誤検知でロールバックするほうが危険 |
| `apps/extension` のデプロイ | Chrome Web Store は未申請、手動運用(`apps/extension/README.md`) |
| git 履歴の書き換え | account/zone ID はクレデンシャルではない(上記) |

### レビュー(フレッシュコンテキストの `reviewer`、2026-07-26)

`aa628d5` に対して実施。**Request Changes**。指摘と対応:

| # | 重大度 | 指摘 | 対応 |
|---|---|---|---|
| H1 | High | verify 系のリトライループが `fetch` の例外で即死する(リトライ 0 回で赤) | **修正**。`checkOnce` を try/catch で包み、例外を「理由の文字列」として既存の戻り値契約に乗せた |
| M1 | Medium | この PR 自身が `shared` パターン(`pnpm-lock.yaml` / `package.json` / `ci.yml`)を触るので、マージすると必ず両方のデプロイが走る。secret 未登録なら初回から main が赤 | **運用で対応**。PR 説明と本節で「マージ前に secret 登録」を明記。コード修正は不要 |
| M2 | Medium | `concurrency` は同時実行を防ぐだけで**順序を保証しない**。連続マージで先発 run が後から古い dist を上書きしうる。しかも verify は自分の artifact と比べるので**緑のまま退行する** | **修正**。デプロイ直前に `gh api` で main の tip を確認し、追い抜かれていたらデプロイ・verify とも skip する |
| M3 | Medium | `verify-worker.mjs` の `property="og:image"` 判定が `og:image:width` にも部分一致し、画像本体のタグが消えても緑 | **修正**。`property="og:image" content="` まで含めて判定 |
| L1 | Low | `--attempts abc` で `Number("abc")` が NaN になり、1 度も検証せずに「NaN 回試して駄目だった」と嘘の理由で落ちる | **修正**。`Number.isFinite` + 正数チェック。トップレベルの `.catch` で 1 行メッセージにして exit 1 |
| L2 | Low | `upload-artifact@v4` は既定で隠しファイルを落とす。将来 `public/.well-known/...` を足すと artifact から静かに欠落 | **修正**。`include-hidden-files: true` |
| L3 / L6 | Low | verify が index.html とエントリ JS しか見ておらず、`robots.txt` / `og.png` / favicon が欠けても緑(S9 と同種の事故) | **修正**。**dist の全ファイル**(現在 7 件)の sha256 を照合するようにした。エントリ JS も最初の 1 個ではなく全件を見る |
| L4 | Low | account ID を secret にすると GitHub がログ全体でその文字列をマスクし、wrangler の出力が読みにくくなる | **修正**。`CLOUDFLARE_ACCOUNT_ID` を secret から外し、ワークフローに平文で置いた(識別子であってクレデンシャルではなく、zone_id と同様に既にコミット済み)。**ユーザーが登録する secret は `CLOUDFLARE_API_TOKEN` の 1 つだけになった** |
| L5 | Low | 公開リポジトリでは `persist-credentials: false` が定石(fork PR のコードが走るジョブで GITHUB_TOKEN を `.git/config` に残さない) | **修正**。ci.yml / lighthouse.yml の全 checkout に付与。tip 確認は `gh api` にしたのでこれと両立する |
| L7 | Low | デプロイジョブに `timeout-minutes` が無い | **修正**。test 20分 / changes 10分 / deploy 15分 |
| L8 | Low(未確認) | `wrangler pages deploy` にコミット情報のフラグを渡していない。ダッシュボードから「どの main が本番か」を引けるかは未確認 | **保留**。CI 上では `.git` があるので wrangler が自動検出する見込みだが未検証。初回デプロイ後にダッシュボードで確認する |
| L9 | Low(未確認) | Dependabot の npm ecosystem が pnpm workspace 配下(`apps/web` / `workers/ogp`)の `wrangler` まで辿るかは未確認 | **保留**。マージ後の初回 Dependabot 実行で確認。辿らなければ `directories` に各パッケージを明示する |

レビューが「問題なし」と確認した主な点: `changes` ジョブのシェル(`set -euo pipefail` 下の
here-string と `grep` の終了ステータス扱い)、fork PR / ブランチ push からデプロイが走らないこと、
script injection が無いこと(`${{ }}` を `run:` 本文に埋めていない)、artifact の受け渡し、
`pnpm run` による組み込み `deploy` コマンドとの衝突回避、既存 CI(lighthouserc.cjs 無変更)。

#### M2 の残余リスク

tip 確認とデプロイの間にはまだ窓が残る(数秒)。ここを閉じるには Cloudflare 側の
デプロイ API に楽観ロックが要るが無いので、**窓を最小化するに留める**。
実運用では 1 人が順にマージするだけなので、ここが問題になる確率は極めて低い。
