# 草崩し (Kusakuzushi) 設計書

GitHub の contribution graph（草)をブロック崩しにするゲーム。
Web アプリ版と Chrome 拡張版の両方を、共通のゲームコアの上に作る。

- Web 版: ユーザー名を入力すると、その人の 1 年分の草がブロックとして出現しプレイできる。結果を X に共有できる
- 拡張版: GitHub のプロフィールページ上の**本物の草**がその場で崩れる

## 1. アーキテクチャ

pnpm workspace のモノレポ。ゲームエンジンをデータ源から完全に分離するのが唯一の重要な設計判断。

```
kusakuzushi/
├── packages/
│   └── core/            # ゲームエンジン(純粋TS、DOM/fetch非依存)
│       ├── model.ts     # ContributionGrid, Brick, GameState
│       ├── physics.ts   # ボール・パドル・衝突(AABB)
│       ├── game.ts      # ループ、スコア、ライフ、クリア判定
│       └── renderer.ts  # Canvas 2D 描画(注入されたcanvasに描く)
├── apps/
│   ├── web/             # Vite + vanilla TS。ユーザー名入力→API→プレイ→共有
│   └── extension/       # Chrome拡張 MV3。content scriptでDOM→グリッド化→オーバーレイ
└── workers/
    └── ogp/             # (Phase 2) Cloudflare Worker: 動的OGP画像生成
```

core は「`ContributionGrid` を受け取り、渡された canvas に描き、結果イベントを返す」だけ。
web と extension はそれぞれの方法でグリッドを作って core に渡すアダプタ。

## 2. データモデル

```ts
type Cell = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 };
type ContributionGrid = {
  username: string;
  weeks: Cell[][];      // 最大53週 × 7日(列=週、行=曜日)。GitHubの描画順と同じ
  total: number;
};
```

### データ源A: Web版 — 非公式API(検証済み)

`GET https://github-contributions-api.jogruber.de/v4/{user}?y=last`

- レスポンス: `{ total: { lastYear: number }, contributions: [{ date, count, level }] }` — **VERIFIED** (2026-07-24 実測)
- `access-control-allow-origin: *` — クライアントから直接叩ける — **VERIFIED**
- 日付フラット配列なので、曜日で折って weeks[][] に変換するアダプタを書く

リスク緩和: `fetchGrid(user): Promise<ContributionGrid>` のインターフェースの後ろに隠す。
サービスが死んだら Cloudflare Worker の自前プロキシ(下記データ源Bと同じパース)に差し替えるだけ。

### データ源B: 拡張版 — ページのDOM(検証済み)

`https://github.com/users/{user}/contributions` が返すフラグメント(プロフィールページに埋め込まれるものと同一)は
`td.ContributionCalendar-day` に `data-date` / `data-level` / `id="contribution-day-component-{row}-{col}"` を持つ — **VERIFIED** (2026-07-24 実測、375セル)

- `count` は td 属性にない(別途 tool-tip 要素にある)が、ゲームには `level` があれば十分。count はスコア表示の飾りなので拡張版では省略可
- `getBoundingClientRect()` で各セルの実座標が取れる → オーバーレイ canvas の位置合わせに使う

## 3. ゲームルール

| 要素 | 仕様 |
|------|------|
| ブロック | level ≥ 1 のセル。level = HP(最大4)。ヒットごとに level が1減り、GitHubの緑5段階の色がそのまま薄くなる |
| level 0 のセル | ブロックなし(ボールは素通り)。草が少ない人はスカスカな面になる — それも味 |
| パドル | 画面下部。マウス/タッチ追従。キーボード(←→)も対応 |
| ボール | 1個。パドルの当たり位置で反射角が変わる標準的なブロック崩し物理 |
| ライフ | 3。ボール落下で1減 |
| スコア | 破壊したブロックの元 count 合計(拡張版は level² などで代替)+ 連続破壊コンボ倍率 |
| クリア | 全ブロック破壊 = 「1年分の草を刈った」 |
| 演出(最小限) | ブロック破壊時のパーティクル(緑の欠片が散る)のみ。SE・その他は Phase 外 |

53×7 のグリッドは横長なので、キャンバスは草の実寸比(横長)を維持し、下に余白を付けてパドル空間にする。

## 4. Web版 (apps/web)

- Vite + vanilla TS。フレームワーク不使用(UIは入力フォーム1つとリザルト画面だけ)
- フロー: `/?user=toshi0607` → API fetch → グリッド描画 → スペースで開始 → リザルト
- デプロイ: **Cloudflare Pages**(実績あり: saikyo.quest で Cloudflare 利用中)

### 共有機能(MVPスコープ)

1. **X共有ボタン**: `https://x.com/intent/post?text=...&url=https://<domain>/?user={name}`
   テキスト例: 「toshi0607 の草 2,942 contributions を 87% 刈り取った🌱 スコア 12,340」
2. **リザルト画像**: ゲーム canvas をそのまま `toBlob()` → ダウンロード / Web Share API(モバイル)。サーバー不要
3. **動的OGP**(Phase 2): `workers/ogp` で `og:image` を生成(satori / workers-og)。
   共有URLをWorker経由(`/share/{user}?s=…`)にし、クローラーにはOGP付きHTML、人間には本体へリダイレクト

MVP は 1+2 まで。3 はリンクの見栄えが欲しくなったら。

## 5. Chrome拡張版 (apps/extension) — Phase 3

- Manifest V3、`content_scripts: [{ matches: ["https://github.com/*"] }]`、権限は最小(`activeTab` すら不要、host permission のみ)
- 草グラフの近くに「🎮 崩す」ボタンを注入
- 起動時: 各 `td` の rect からグリッドと実座標を取り、草グラフ全体に `position: fixed` の canvas をオーバーレイ
- 破壊演出: core がブロックを消すと同時に、対応する実 `td` の背景を `--color-calendar-graph-day-bg`(level 0 の色)に差し替える。**本物の草が減っていくように見える**のがこの版の核
- 終了/リロードで原状復帰(スタイルを外すだけ。DOMは破壊しない)
- SPA遷移(turbo)対応: `turbo:load` イベントでボタン再注入

リスク: GitHub の DOM 変更で壊れる(宿命)。セレクタとグリッド構築を1ファイルに隔離して修理しやすくする。

## 6. 技術スタック

| 項目 | 選定 | 理由 |
|------|------|------|
| 言語 | TypeScript | — |
| モノレポ | pnpm workspace | 軽量、拡張とwebでcoreを共有 |
| ビルド | Vite(web)/ Vite + CRXJS or 素のesbuild(extension) | Phase 3 で決定 |
| 描画 | Canvas 2D | ブロック数最大371、物理も単純。WebGL不要 |
| テスト | Vitest | core の物理・グリッド変換のユニットテスト |
| ホスティング | Cloudflare Pages(+ Workers) | 既存アカウント・経験あり |

## 7. フェーズ計画

| Phase | 内容 | 完了条件 |
|-------|------|----------|
| 1 | core + web版MVP(入力→プレイ→リザルト→X共有・画像保存) | 自分のユーザー名で最後まで遊べ、共有リンクが機能する |
| 2 | 動的OGP Worker、演出磨き | Xでカードプレビューが出る |
| 3 | Chrome拡張版 | 自分のプロフィールで本物の草が崩せる |

実装開始時に Phase 1 を `tasks/todo.md` に展開する(Constraint/Assumption Ledger 込み)。

## 8. 未確定事項・既知のリスク

| 項目 | 状態 |
|------|------|
| jogruber API のレート制限・可用性 | UNVERIFIED — 個人規模なら実用上問題ないと推定(GUESS)。アダプタ分離で緩和済み |
| private contribution | 本人が「Private contributions を表示」設定にしていない限り出ない(API/DOMとも公開分のみ)。仕様として許容 |
| プロダクト名 | 仮: 草崩し / kusakuzushi。ドメイン取るなら要検討 |
| 草ゼロ(全level 0)ユーザー | 「崩す草がありません🌵」画面を出す。エッジケースとして todo に入れる |
