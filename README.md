# 草崩し (Kusakuzushi)

GitHub の contribution graph — いわゆる「草」— をブロック崩しにするゲーム。

**遊ぶ: https://kusakuzushi.toshi0607.com**

ユーザー名を入れると、その人の 1 年分の草がそのままブロックになる。
崩したブロックは GitHub の緑 5 段階の色がそのまま薄くなっていくので、
盤面が減る = 草を刈っている、が見た目で分かる。

Chrome 拡張版もあり、そちらは **GitHub のプロフィールページ上の本物の草**を
その場で崩す(キャンバスに描き直すのではなく、実際の `td` の背景色を差し替える)。

> **English** — Kusakuzushi turns a GitHub contribution graph into a playable game of
> Breakout. Type a username on the web app and that person's last year of contributions
> becomes the brick field; each hit drops a cell one level down GitHub's five-step green
> scale. The Chrome extension does the same thing to the *real* graph on a GitHub profile
> page, by recoloring the actual `td` elements. Everything below this line is in Japanese —
> the short version is: `pnpm install && pnpm --filter @kusakuzushi/web dev`.
> Licensed under the [MIT License](LICENSE).

## 構成

pnpm workspace のモノレポ。**ゲームエンジンをデータ源から完全に分離する**のが唯一の重要な設計判断で、
web 版と拡張版は「それぞれの方法で `ContributionGrid` を作って core に渡すアダプタ」でしかない。

| パッケージ | 中身 |
|---|---|
| [`packages/core`](packages/core) | ゲームエンジン。純粋 TS で DOM も fetch も参照しない。物理・スコア・描画(渡された canvas に描く) |
| [`apps/web`](apps/web) | Vite + vanilla TS の Web 版。ユーザー名 → API → プレイ → リザルト → X 共有 |
| [`apps/extension`](apps/extension) | Chrome 拡張 (Manifest V3)。content script が GitHub の DOM を読んでオーバーレイする → [README](apps/extension/README.md) |
| [`workers/ogp`](workers/ogp) | Cloudflare Worker。`/share/{user}` にクローラーが来たらスコア入りの OGP 画像付き HTML、人間が来たら本体へ 302 |

データ源はこの 2 つ。core はどちらも知らない。

- Web 版: [github-contributions-api.jogruber.de](https://github-contributions-api.jogruber.de)(非公式・CORS 許可)。
  `fetchGrid(user)` の後ろに隠してあるので、止まったら自前 Worker プロキシに差し替えられる
- 拡張版: GitHub のプロフィールページの DOM(`td.ContributionCalendar-day` の `data-date` / `data-level`)。通信は一切しない

設計の詳細は [DESIGN.md](DESIGN.md)、見た目の判断は [DESIGN-VISUAL.md](DESIGN-VISUAL.md)、
実装の経緯とセッションごとの記録は [tasks/todo.md](tasks/todo.md) にある。

## 開発

Node 26 / pnpm 10.30(`packageManager` フィールドで固定)で確認している。

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

拡張版の読み込み手順(unpacked)は [`apps/extension/README.md`](apps/extension/README.md) にある。
Chrome ウェブストアにはまだ出していない。

## デプロイ

**main にマージすると自動で出る。** 手で `wrangler` を叩く必要はない。

```
PR: test / Lighthouse dist / Lighthouse slow  ← ここがゲート
main へ push: test → deploy-web / deploy-ogp → 本番スモーク
```

- 変更パスを見て `apps/web`(Cloudflare Pages)と `workers/ogp`(Worker)を出し分ける
- デプロイするのはテストを通した**その成果物**(`test` ジョブが上げた artifact をそのまま配る)
- デプロイ後、`tools/verify-deploy.mjs` が「本番が配信しているものが手元の `dist` と
  sha256 まで一致するか」を全ファイル突き合わせる。`tools/verify-worker.mjs` は Worker の
  クローラー / 人間 / 不正パラメータの 3 分岐を叩く。**ステータスコードは中身を保証しない**ので、
  200 が返ることでは終わらせない

手元から出したいときだけ `pnpm deploy:web` / `pnpm deploy:ogp`(要 Cloudflare 認証)。

## セキュリティ

脆弱性を見つけた場合は Issue ではなく [SECURITY.md](SECURITY.md) の手順で報告してほしい。

## ライセンス

[MIT License](LICENSE) — Copyright (c) 2026 toshi0607

崩した草は見た目が変わるだけで、GitHub 上のデータには一切触れない。
