# 草崩し (Kusakuzushi)

GitHub の contribution graph — いわゆる「草」— をブロック崩しにするゲームです。

**遊ぶ: https://kusakuzushi.toshi0607.com**

ユーザー名を入れると、その人の 1 年分の草がそのままブロックになります。
崩したブロックは GitHub の緑 5 段階の色がそのまま薄くなっていくので、
盤面が減る = 草を刈っている、が見た目で分かります。

**Chrome 拡張版: https://chromewebstore.google.com/detail/gbjockgldlkgpjdlnlbefgmnmfbhcbaf**

拡張版は **GitHub のプロフィールページ上の本物の草**をその場で崩します
(キャンバスに描き直すのではなく、実際の `td` の背景色を差し替えます)。

> **English** — Kusakuzushi turns a GitHub contribution graph into a playable game of
> Breakout. Type a username on the web app and that person's last year of contributions
> becomes the brick field; each hit drops a cell one level down GitHub's five-step green
> scale. The Chrome extension does the same thing to the *real* graph on a GitHub profile
> page, by recoloring the actual `td` elements. Everything below this line is in Japanese —
> the short version is: `pnpm install && pnpm --filter @kusakuzushi/web dev`.
> Licensed under the [MIT License](LICENSE).

## 構成

pnpm workspace のモノレポです。**ゲームエンジンをデータ源から完全に分離する**のが唯一の重要な設計判断で、
web 版と拡張版は「それぞれの方法で `ContributionGrid` を作って core に渡すアダプタ」でしかありません。

| パッケージ | 中身 |
|---|---|
| [`packages/core`](packages/core) | ゲームエンジン。純粋 TS で DOM も fetch も参照しない。物理・スコア・描画(渡された canvas に描く) |
| [`apps/web`](apps/web) | Vite + vanilla TS の Web 版。ユーザー名 → API → プレイ → リザルト → X 共有 |
| [`apps/extension`](apps/extension) | Chrome 拡張 (Manifest V3)。content script が GitHub の DOM を読んでオーバーレイする → [README](apps/extension/README.md) |
| [`workers/ogp`](workers/ogp) | Cloudflare Worker。`/share/{user}` にクローラーが来たらスコア入りの OGP 画像付き HTML、人間が来たら本体へ 302。`/api/grid/{user}` で草データを Web 版に渡す |
| [`workers/mcp`](workers/mcp) | Cloudflare Worker(Agents SDK の `McpAgent`)。`/mcp` にリモート MCP サーバーを置き、草データの取得と共有カードの生成をエージェント向けツールとして公開する |

データ源はこの 2 つで、core はどちらも知りません。

- Web 版: 同一オリジンの `/api/grid/{user}`(`workers/ogp`)。Worker が
  [github-contributions-api.jogruber.de](https://github-contributions-api.jogruber.de)(非公式)を叩いて
  検証した JSON を返します。ページは第三者に直接つながらず、上流を替えるのは Worker のデプロイだけで済みます
- 拡張版: GitHub のプロフィールページの DOM(`td.ContributionCalendar-day` の `data-date` / `data-level`)。通信は一切しません

### エージェント向けツール(WebMCP / MCP)

Web 版は [WebMCP](https://github.com/webmachinelearning/webmcp) に対応しています。
native の `navigator.modelContext` を持つブラウザ(Chrome の Origin Trial / `chrome://flags/#enable-webmcp-testing`)では、
ページが次のツールを登録します。それ以外のブラウザでは何も読み込みません(ページのスクリプト予算を守るため)。

| ツール | 実行場所 | 内容 |
|---|---|---|
| `start_game(user)` | ページ | フォームと同じ経路でゲームを開始する。プレイ中は拒否 |
| `get_game_state()` | ページ | フェーズ・スコア・刈り取り率・残機・残りブロック |
| `remote.get_contribution_grid(user)` | `workers/mcp` → `workers/ogp` | 53 週 × 7 日の level 文字列と合計 |
| `remote.render_share_card(user, percentage, score?)` | `workers/mcp` → `workers/ogp` | 共有カードを生成し、画像 URL・共有 URL・X の投稿文を返す(画像本体は返さない) |

`remote.*` は Cloudflare Agents SDK の `registerWebMcp()` が `/mcp` の MCP サーバーから映したものです。
`/mcp` は Streamable HTTP のリモート MCP サーバーとしてブラウザなしでも使えます:

```bash
claude mcp add --transport http kusakuzushi https://kusakuzushi.toshi0607.com/mcp
```

どのツールもブラウザのストレージには書きません(E2E で固定)。サーバー側に残るのは MCP の接続セッション(Durable Object)だけです。設計の記録は [tasks/webmcp-article-notes.md](tasks/webmcp-article-notes.md)。

設計の詳細は [DESIGN.md](DESIGN.md)、見た目の判断は [DESIGN-VISUAL.md](DESIGN-VISUAL.md)、
実装の経緯とセッションごとの記録は [tasks/todo.md](tasks/todo.md) にあります。

## 開発

Node 26 / pnpm 10.30(`packageManager` フィールドで固定)で確認しています。

```bash
pnpm install
pnpm --filter @kusakuzushi/web dev   # http://localhost:5173
```

| コマンド | 内容 |
|---|---|
| `pnpm -r test` | 全パッケージの Vitest |
| `pnpm -r build` | 全パッケージの型チェック + ビルド |
| `pnpm lh` | ローカルの `apps/web/dist` に Lighthouse CI をかける |
| `pnpm lh:prod` | 本番 URL に Lighthouse CI をかける |
| `pnpm test:e2e` | Playwright。`wrangler dev`(MCP + OGP Worker)と `vite preview` を立てて WebMCP のツールをブラウザから叩く |
| `pnpm test:e2e:prod` | 同じスモークを本番 URL に対して行う |

`pnpm dev` の `/api` と `/mcp` は既定で本番の Worker にプロキシされます(`KUSAKUZUSHI_API_PROXY` / `KUSAKUZUSHI_MCP_PROXY` でそれぞれ `wrangler dev` に向けられます。レート制限はクライアント IP ごとなので、手元の連打で他の人の枠は減りません)。

開発中の拡張を読み込む手順(unpacked)は [`apps/extension/README.md`](apps/extension/README.md) にあります。
公開版は Chrome ウェブストアから入ります → [草崩し (Kusakuzushi)](https://chromewebstore.google.com/detail/gbjockgldlkgpjdlnlbefgmnmfbhcbaf)

## デプロイ

**main にマージすると自動で出ます。** 手で `wrangler` を叩く必要はありません。

```
PR: test / e2e / Lighthouse dist / Lighthouse slow  ← ここがゲート
main へ push: test → deploy-ogp → deploy-web / deploy-mcp → 本番スモーク(verify-* / verify-webmcp)
```

- 変更パスを見て `apps/web`(Cloudflare Pages)、`workers/ogp`、`workers/mcp`(Worker)を出し分けます。
  web と mcp は ogp の `/api/grid` と Service Binding に依存するので、ogp の後に出します
- デプロイするのはテストを通した**その成果物**です(`test` ジョブが上げた artifact をそのまま配ります)
- デプロイ後、`tools/verify-deploy.mjs` が「本番が配信しているものが手元の `dist` と
  sha256 まで一致するか」を全ファイル突き合わせます。`tools/verify-worker.mjs` は OGP Worker の
  クローラー / 人間 / 不正パラメータ / 草データの 6 分岐、`tools/verify-mcp.mjs` は MCP の
  ハンドシェイクからツール呼び出しまでを叩きます。**ステータスコードは中身を保証しない**ので、
  200 が返ることでは終わらせません

手元から出したいときだけ `pnpm deploy:web` / `pnpm deploy:ogp` / `pnpm deploy:mcp` を使います(要 Cloudflare 認証)。

## セキュリティ

脆弱性を見つけた場合は Issue ではなく [SECURITY.md](SECURITY.md) の手順で報告してください。

## ライセンス

[MIT License](LICENSE) — Copyright (c) 2026 toshi0607

崩した草は見た目が変わるだけで、GitHub 上のデータには一切触れません。
