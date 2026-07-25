# Chrome ウェブストア 掲載情報

デベロッパーコンソール(https://chrome.google.com/webstore/devconsole)に貼り込む原稿。
コンソール側を直接いじって済ませず、必ずここを更新してからコピーすること
(次のリリースで何を書いたか分からなくなるため)。

- 提出物: `pnpm --filter @kusakuzushi/extension package` が出す
  `apps/extension/kusakuzushi-extension-<version>.zip`
- 画像: このディレクトリの `promo-tile-440x280.png` と `screenshots/`
- バージョンの正: `apps/extension/manifest.json`(アップロードのたびに増やす必要がある)

---

## 1. 名前・説明(manifest 由来)

名前と簡単な説明はストアが `_locales` から自動で引くので、コンソールでは編集しない。
変更するときは `apps/extension/_locales/{en,ja}/messages.json` を直す。

| ロケール | 名前 | 簡単な説明(132 文字以内) |
|---|---|---|
| en(既定) | Kusakuzushi — Break your GitHub grass | Turns the contribution graph on a GitHub profile into a playable game of Breakout, right where it stands. |
| ja | 草崩し (Kusakuzushi) | GitHub のプロフィールページの草を、その場でブロック崩しにする |

既定ロケールを en にしているのは、審査担当者が最初に読む文面を英語にするため。

## 2. 詳細な説明

### ja

```
GitHub のプロフィールページを開いて、草グラフの下に出る「🎮 崩す」を押すだけ。
1 年分のコントリビューショングラフが、そのままブロック崩しの盤面になります。

■ 本物の草がブロックになる
キャンバスに絵を描き直すのではなく、GitHub が表示している草のマス目そのものを
ブロックとして扱います。崩したマスは実際に灰色になり、盤面が減っていくのが
プロフィールの上でそのまま見えます。

■ 遊び方
1. https://github.com/{ユーザー名} を開く
2. 草グラフの下の「🎮 崩す」を押す
3. マウスでパドルを動かし、クリックか Space キーで発射
4. 「やめる」を押すか、他のページへ移動すると元通りになります

崩した草は見た目が変わるだけで、GitHub 上のデータは一切変更されません。
ページを再読み込みすれば元に戻ります。

■ プライバシー
この拡張は通信を一切行いません。外部サーバーへのアクセス、アクセス解析、広告、
Cookie や chrome.storage への保存は、いずれもありません。草の読み取りと描画は
すべてあなたのブラウザの中だけで完結します。

■ ブラウザで先に試す
インストールせずに遊べる Web 版があります: https://kusakuzushi.toshi0607.com

■ 権限について
GitHub のプロフィールページ上で動作する必要があるため github.com へのアクセスを
宣言していますが、用途は草グラフの読み取りとゲーム画面の描画だけです。
GitHub 以外のサイトでは一切動作しません。
```

### en

```
Open any GitHub profile, press the "🎮 崩す" (Break) button under the contribution
graph, and a year of green squares becomes a playable game of Breakout.

■ The real grass is the bricks
Nothing is redrawn on a canvas. The extension treats the contribution cells that
GitHub already rendered as the bricks themselves, so a destroyed cell actually turns
grey and you watch the graph thin out in place on the profile.

■ How to play
1. Open https://github.com/{username}
2. Press "🎮 崩す" under the contribution graph
3. Move the paddle with the mouse, launch with a click or the Space key
4. Press "やめる" (Quit) or navigate away to restore the page

Broken cells are a visual effect only. No data on GitHub is modified, and reloading
the page restores everything.

■ Privacy
This extension makes no network requests at all. No external servers, no analytics,
no ads, no cookies, and nothing written to chrome.storage. Reading the graph and
drawing the game happen entirely inside your browser.

■ Try it in the browser first
A web version you can play without installing: https://kusakuzushi.toshi0607.com

■ About the permission
The extension declares access to github.com because it has to run on GitHub profile
pages. It is used only to read the contribution graph and draw the game. The
extension does not run on any other site.
```

## 3. カテゴリ・言語

| 項目 | 値 |
|---|---|
| カテゴリ | コンソールのドロップダウンから選ぶ。第一候補は **Fun / Just for Fun**(娯楽)、次点で **Developer Tools**。ゲームであって開発支援ではないので前者を推す |
| 言語 | 日本語 と 英語 の両方を追加 |
| Homepage URL | https://kusakuzushi.toshi0607.com |
| Support URL | https://github.com/toshi0607 |

## 4. プライバシータブ

### 単一用途の説明 (Single purpose)

```
This extension has one purpose: to turn the contribution graph shown on a GitHub
profile page into a playable Breakout game, in place on that page. It reads the
already-rendered contribution cells, overlays a transparent game canvas on them, and
restores the page when the game ends.
```

### 権限の正当性 (Permission justification)

`permissions` は空。宣言しているのは content script の host match のみ。

**Host permission — `https://github.com/*`**

```
The extension has to run on GitHub profile pages to overlay the game on the
contribution graph that GitHub renders there. GitHub usernames can be any string, so
no match pattern can target profile pages alone; https://github.com/* is the
narrowest pattern that covers them. The content script only reads the contribution
cells in the page DOM and draws the game canvas. It makes no network requests, stores
nothing, and does not run on any other site.
```

**リモートコードの使用**: なし(esbuild で全依存をバンドルした単一の `content.js` のみ)。

### データ利用 (Data usage)

収集する情報の種類 — **すべてチェックしない**。以下が検証済みの根拠。

| 主張 | 根拠 |
|---|---|
| ネットワーク通信をしない | `apps/extension/src` に `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` の参照なし。ビルド後の `dist/content.js` に `http(s)://` の文字列が 1 件も無い |
| 保存をしない | 同ソースに `localStorage` / `sessionStorage` / `chrome.storage` / `document.cookie` の参照なし |
| chrome API を使わない | 同ソースに `chrome.` の参照なし |

証明コマンド(再確認用):

```bash
cd apps/extension
grep -rn "fetch\|XMLHttpRequest\|localStorage\|sessionStorage\|chrome\.\|sendBeacon\|WebSocket" src/ --include="*.ts" | grep -v "\.test\.ts"
grep -o "https\?://[a-zA-Z0-9./_-]*" dist/content.js
```

証明書欄(3 つのチェックボックス)はいずれも該当するので **すべてチェックする**:

- 認証された用途にのみデータを使用する
- データを承認された用途以外で第三者へ販売・譲渡しない
- 信用調査や融資目的でデータを使用・転送しない

### プライバシーポリシー URL

```
https://kusakuzushi.toshi0607.com/privacy
```

## 5. 配布

| 項目 | 値 |
|---|---|
| 公開範囲 | **限定公開されないテスト版 (Private)** — まず信頼できるテスターだけで動作確認する(ユーザー決定 2026-07-26) |
| 信頼できるテスター | デベロッパーコンソールの Account タブで自分の Google アカウントを追加しておく |
| 地域 | 全世界(制限しない) |

Public に切り替えるときは、この表を更新してから同じ zip を再送信すればよい。
