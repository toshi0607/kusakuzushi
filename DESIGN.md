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
| パドル | 画面下部。マウスは盤面追従、キーボード(←→)も対応。タッチは盤面ではなく**盤面下のパドルレール**で操作する(レールが出ない端末ではタッチも盤面追従にフォールバック。DESIGN-VISUAL §3) |
| ボール | 通常1個。パドルの当たり位置で反射角が変わる標準的なブロック崩し物理 |
| アイテム | ブロック破壊時に落下(2種)。確率は**序盤 22% → 終盤 8%** に線形で下がる(破壊済み割合で補間)。玉1個で手が足りない立ち上がりを厚くし、玉が増えた終盤は絞る。パドル(追加バー含む)で受けると発動。落球でその場の落下アイテム・効果はリセット。色は種類ごとに別で、玉増加=青・バー増加=紫(どちらも草の緑・玉のアンバーとは別の色) |
| ├ 玉が増える | **飛んでいる玉が全部3倍**に分裂する(取るたびに複利で増え、上限200個)。草が多い年でも刈り切れるようにするための倍加。全部落ちて初めてライフが減る |
| └ バーが増える | パドルの左右にバーが1本ずつ(幅は半分)12秒間出る。隙間はボール半径ぶんで、玉がすり抜けない幅 |
| ライフ | 3。玉が全部落ちると1減 |
| スコア | 破壊したブロックの元 count 合計(拡張版は level² などで代替)+ 連続破壊コンボ倍率 |
| クリア | 全ブロック破壊 = 「1年分の草を刈った」 |
| 演出(最小限) | ブロック破壊時のパーティクル(緑の欠片が散る)のみ。SE・その他は Phase 外 |

53×7 のグリッドは横長なので、キャンバスは草の実寸比(横長)を維持し、下に余白を付けてパドル空間にする。

**ブロックは正方形 + 本家と同じ隙間比**(core `computeLayout` / `brickGapPx`)。github.com の contribution セルは 10px 角・3px 間隔 = ストライドの 23% が隙間で、この 2 つが揃って初めて盤面が「草グラフに見える」。形だけ正方にして隙間を詰めると一枚の緑の板になり、1 日 1 セルという意味が読めない。

一辺はキャンバス幅と列数から決まり(既定 960 幅 / 53 列 / gap 4 → 14.04px、隙間比 22%)、7 行ぶんの帯は約 134px。キャンバス高 360(8:3)はその帯の下にパドル空間 226px を残す値 — 草の帯は盤面の 37%、残りが遊び場になる。拡張版は本物の `td` を実測して同じ幾何を逆算する(高さは `brickHeightPx` で実測値を直接渡す — 実 DOM に重ねる側では「正方形であるべき」より「実際にそうである」が優先)。

## 4. Web版 (apps/web)

- Vite + vanilla TS。フレームワーク不使用(UIは入力フォーム1つとリザルト画面だけ)
- フロー: `/?user=toshi0607` → API fetch → グリッド描画 → スペースで開始 → リザルト
- デプロイ: **Cloudflare Pages**(実績あり: saikyo.quest で Cloudflare 利用中)
- ドメイン: **kusakuzushi.toshi0607.com**(toshi0607.com のサブドメイン。ユーザー決定 2026-07-24)

### 共有機能(MVPスコープ)

1. **X共有ボタン**: `https://x.com/intent/post?text=...&url=https://<domain>/?user={name}`
   テキスト例: 「toshi0607 の草 2,942 contributions を 87% 刈り取った🌱 スコア 12,340」
2. **リザルト画像**: ゲーム canvas をそのまま `toBlob()` → ダウンロード / Web Share API(モバイル)。サーバー不要
3. **動的OGP**(Phase 2): `workers/ogp` で `og:image` を生成(satori / workers-og)。
   共有URLをWorker経由(`/share/{user}?s=…`)にし、クローラーにはOGP付きHTML、人間には本体へリダイレクト
   `s`(スコア)は**任意**。無いリンク(= 拡張からの共有、§5)ではカードのスコア行を出さない —
   0 で埋めると「100% 刈り取ってスコア 0」になる

MVP は 1+2 まで。3 はリンクの見栄えが欲しくなったら。

## 5. Chrome拡張版 (apps/extension) — Phase 3

- Manifest V3、`content_scripts: [{ matches: ["https://github.com/*"] }]`、権限は最小(`activeTab` すら不要、host permission のみ)
- 草グラフの近くに「🎮 崩す」ボタンを注入
- 起動時: 各 `td` の rect からグリッドと実座標を取り、草グラフ全体に `position: fixed` の canvas をオーバーレイ
- 破壊演出: core がブロックを消すと同時に、対応する実 `td` の背景を `--color-calendar-graph-day-bg`(level 0 の色)に差し替える。**本物の草が減っていくように見える**のがこの版の核
- 終了/リロードで原状復帰(スタイルを外すだけ。DOMは破壊しない)
- SPA遷移(turbo)対応: `turbo:load` イベントでボタン再注入

リスク: GitHub の DOM 変更で壊れる(宿命)。セレクタとグリッド構築を1ファイルに隔離して修理しやすくする。

### 共有機能(拡張)

リザルトバナーに「Xで共有」。ページ内の `<a target="_blank">` なので、権限は増えない(content script のみのまま)。

**載せるのは刈り取り率だけ**で、スコアと contributions 数は出さない。GitHub の DOM は日ごとの
contribution 数を持たないため、拡張のブロックには `count = level²` を合成している(`adapter.ts`)。
つまり拡張のスコアは実 contributions から出る web のスコアと桁が違い、`ContributionGrid.total` も
contributions 数ではない。同じ `#草崩し` に比較できない数字が 2 種類流れるほうが、率だけを言うより悪い。
率は分子・分母が同じ重みなので、両版で同じ意味を保つ。

文面と共有 URL の組み立ては web と共有する(`packages/core/src/share-link.ts`)— ハッシュタグと
`/share/{user}` の形を 1 箇所に閉じるため。

「画像を保存」は移植していない: オーバーレイ canvas は透明で、ブロックは実 `td` が描いている
(`td-paint.ts`)ので canvas を撮っても盤面が写らない。DOM ごと撮るには `chrome.tabs.captureVisibleTab`
= 権限追加 + background が必要で、この機能のために払う額ではない。

## 6. 技術スタック

| 項目 | 選定 | 理由 |
|------|------|------|
| 言語 | TypeScript | — |
| モノレポ | pnpm workspace | 軽量、拡張とwebでcoreを共有 |
| ビルド | Vite(web)/ Vite + CRXJS or 素のesbuild(extension) | Phase 3 で決定 |
| 描画 | Canvas 2D | ブロック数最大371、物理も単純。WebGL不要 |
| テスト | Vitest | core の物理・グリッド変換のユニットテスト |
| ホスティング | Cloudflare Pages(+ Workers) | 既存アカウント・経験あり |

## 6.1 パフォーマンス計測(Lighthouse CI)

しきい値と計測対象の正は `lighthouserc.cjs`。ワークフローは `.github/workflows/lighthouse.yml`。

| コマンド | 対象 | 用途 |
|----------|------|------|
| `pnpm lh` | `apps/web/dist` をローカル静的サーバで配信 | PR/main で毎回。外部要因が入らないので差分の影響だけが出る |
| `pnpm lh:prod` | 本番 URL | 毎日 06:00 JST + 手動。デプロイ済みの実物の劣化を拾う |

どちらも mobile / 3 runs、判定は中央値。レポート(json + html)は GitHub Actions の artifact に 30 日残る。

計測しているのはトップページのみ(`/?user=...` は外部 API の応答時間に左右されて数値が安定しないため)。
拡張版はページ所有者が GitHub なので計測対象外。

**この構成が守っている性質**: Google Fonts の CSS を素の `<link rel="stylesheet">` に戻すと
`render-blocking-resources` が 1 → 3 に増え、FCP/LCP が 0.9s → 3.0s に戻って CI が落ちる(実測で確認済み)。

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
