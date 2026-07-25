# 草崩し Chrome 拡張 (@kusakuzushi/extension)

GitHub のプロフィールページ上の**本物の草**をその場でブロック崩しにする Manifest V3 拡張。
Web 版 (`apps/web`) と同じゲームエンジン (`packages/core`) を、DOM から作ったグリッドで動かす。

## 使い方

```bash
pnpm --filter @kusakuzushi/extension build
```

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパー モード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」→ `apps/extension/dist` を選択
4. `https://github.com/{ユーザー名}` を開き、草グラフの下に出る「🎮 崩す」を押す
5. マウスでパドルを動かし、クリックか Space で発射。破壊した日の草は実際に灰色になる
6. 「やめる」か、他のページへ遷移すると原状復帰する

開発中は `pnpm --filter @kusakuzushi/extension dev`(esbuild watch)。
ビルドのたびに `chrome://extensions` で拡張のリロードが必要。

## 構成

| ファイル | 役割 |
|----------|------|
| `src/main.ts` | エントリポイント。副作用を持つ唯一のモジュール(`autoMount` を呼ぶだけ) |
| `src/grass-dom.ts` | **GitHub の DOM を知る唯一のファイル**。セレクタ・セル読み取り・幾何計測。GitHub のマークアップが変わったらここだけ直す |
| `src/adapter.ts` | 草セル → core の `ContributionGrid` / `GameConfig`。DOM に contribution 数が無いため `count = level²` を投入する |
| `src/overlay.ts` | 草の上に重ねる透過キャンバス |
| `src/renderer.ts` | 拡張専用の透過レンダラ(ボール・パドル・落下アイテム・パーティクル・HUD だけ描く) |
| `src/td-paint.ts` | 実 `td` の背景差し替えと原状復帰 |
| `src/content.ts` | ボタン注入・入力・ゲームループと、`autoMount`(草の出現待ち・turbo・bfcache) |

### 草はページの初期 HTML に無い

GitHub は草グラフを `<include-fragment>` で後から流し込むため、`document_idle` で1回だけ探しても
見つからない(`turbo:load` も fragment 解決より先に発火する)。`autoMount` は MutationObserver で
草の出現を待ち、さらに fragment が差し替わってボタンごと消えた場合も貼り直す。

ブロックの**見た目は実 `td` そのもの**で、キャンバスは描かない。だから破壊時に `td` の背景を
level 0 の色へ差し替えると、本物の草が減っていくように見える(DESIGN.md §5)。

## 幾何

core の `computeLayout` はブロック矩形をキャンバス寸法から一意に決めるので、実 `td` に重ねるには
逆算した `GameConfig` を渡す(`deriveConfig`)。実測のセル 10px・ギャップ 3px・53 週なら:

- `canvasWidth = cols * (cellWidth + gap) + gap` = 692
- `canvasHeight = 2 * (7 * cellHeight + 9 * gap)` = 194(上半分が草、下半分がパドル空間)
- オーバーレイの原点 = 左上セルの page 座標 − gap

この式を変えるとブロックと草がズレる。`src/adapter.test.ts` が 1:1 対応を検証している。
