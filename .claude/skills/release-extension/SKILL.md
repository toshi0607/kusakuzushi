---
name: release-extension
description: 草崩し Chrome 拡張を Chrome ウェブストアに提出する。バージョンを上げて zip を作り、デベロッパーコンソールへ入力するまでの手順と、実際に踏んだ落とし穴。「拡張をリリースする」「ストアに出す」「新しいバージョンを出す」ときに使う。
---

# 草崩し拡張のリリース

初回提出は 2026-07-27 に完了済み（アイテム ID `gbjockgldlkgpjdlnlbefgmnmfbhcbaf`、Trusted Tester 限定）。
このスキルは **2 回目以降** を想定している。初回に必要だったアカウント設定
（$5 の登録・連絡先メールの確認・Trusted Tester の追加）は**アカウント共通なので再実行不要**。

## 原本の場所

コンソール側を直接いじって済ませない。必ずここを更新してからコピーする。

| 何 | どこ |
|---|---|
| 掲載文・カテゴリ・プライバシー回答の文言 | `apps/extension/store/listing.md` |
| 拡張の名前と簡単な説明 | `apps/extension/_locales/{en,ja}/messages.json`（コンソールでは編集しない） |
| バージョン | `apps/extension/manifest.json` |
| スクリーンショット・プロモタイル | `apps/extension/store/` |

## 手順

### 1. バージョンを上げる

`apps/extension/manifest.json` の `version` を上げる。`package.json` の
`version` も揃える。**ストアは前回より大きい値しか受け付けない。**

### 2. zip を作る

```bash
pnpm --filter @kusakuzushi/extension package
```

`dist` を作り直して `apps/extension/kusakuzushi-extension-<version>.zip` を出す。
出力の `unzip -l` を必ず読む。**ルートに `manifest.json` があること**を確認する
（`dist/` ごと包んだ zip はストアに拒否される）。`_locales/{en,ja}` が入っていることも見る
（`default_locale` に対応するロケールが欠けると Chrome が manifest エラーで読み込みを拒否する）。

### 3. 提出ファイルを 1 か所に集める

ネイティブのファイルダイアログは自動化できず、ユーザーが選ぶ。選びやすい場所に置く。

```bash
DEST=~/Desktop/kusakuzushi-store
rm -rf "$DEST" && mkdir -p "$DEST"
SRC=apps/extension
cp "$SRC"/kusakuzushi-extension-*.zip "$DEST/"
cp "$SRC"/store/promo-tile-440x280.png "$DEST/"
cp "$SRC"/store/screenshots/*.png "$DEST/"
cp "$SRC"/icons/icon-128.png "$DEST/store-icon-128.png"
```

### 4. コンソールに入力する

<https://chrome.google.com/webstore/devconsole> の該当アイテム。
**バージョンを上げただけなら「パッケージ」タブに zip を上げるだけでよい**
（掲載文・画像はアイテムに残っている）。掲載文を変えたときだけ 5 以降も行う。

### 5. 送信

「審査のため送信」は**公開行為なのでユーザーが押す**。押す前に全項目を読み上げて確認する。
押したあと、ステータスが「ドラフト」→「審査待ち」に変わることを実測する。

## 見た目を変えたらスクリーンショットを撮り直す

掲載画像は実物と一致していないといけない。玉の色やバーの形を変えたリリースでは、
`store/screenshots/` の 4 枚が前の見た目のまま残る。**撮り直しは自動化してある。**

```bash
node .claude/skills/release-extension/capture-screenshots.mjs
for f in apps/extension/store/screenshots/*.png; do sips -c 800 1280 "$f"; done
```

やっていること（`capture-screenshots.mjs`）:

- 実物の GitHub プロフィールを開き、**草グラフの見出しと表の祖先でない要素をすべて `display:none`** にする。
  これで所属組織・Pinned リポジトリ・アクティビティが構図から消える（**組織名は絶対に写さない**）
- `dist/content.js` をページに直接 `evaluate` する。バンドルは `chrome.*` API を使っていないので、
  拡張として読み込む必要がない（Chrome 137 以降 `--load-extension` は自動化フラグ下で効かない）
- 玉のアンバー `#ffb224` をキャンバスから拾って重心 x を出し、そこへマウスを動かして**自動でラリーする**
- 04 は `itemDropChance` を 1 に書き換えたコピーを注入して、アイテムが必ず落ちる状態を撮る

**Primer のユーティリティクラスは `!important`** なので、要素を隠すときは
`style.setProperty("display", "none", "important")` でないと効かない（`d-md-block` に負ける）。

ビューポートは 915x572・`deviceScaleFactor` 1.4。これで既存 4 枚と同じセルサイズの
1280x800 になる（出力は 1281x801 なので `sips` で 1 px 落とす）。

## 落とし穴（すべて 2026-07-27 に実際に踏んだ）

### 画像を上げたら必ず「下書きとして保存」する

保存前に「送信できない理由」を開くと「アイコン画像がありません／スクリーンショットが必要です」
と出る。**判定はサーバー側の保存済み状態を見ている**ので、画面にサムネイルが出ていても
保存していなければ未登録として扱われる。保存 → 再判定で消える。

### スクリーンショットは「全言語向け」に入れる

画像アセット欄には似た見出しが 2 つある。

- 「ローカライズ版スクリーンショット」… **今選んでいるロケールにだけ**付く
- 「全言語向けスクリーンショット」… 全ロケールで表示される

最初に en ロケールで作業していて「ローカライズ版」に入れてしまい、日本語で見ると 0 枚になっていた。
スクショに日本語 UI が写っている以上、これは実害がある。**「全言語向け」に入れる。**

### プライバシーポリシー URL はデータ収集ゼロでも必須

「プライバシー ポリシーの URL」には必須マーク `*` が付いている。何も収集していなくても要る。
草崩しは <https://kusakuzushi.toshi0607.com/privacy/>（末尾スラッシュ付きが実体。
`/privacy` は Pages が 308 で寄せるので、リダイレクトを挟まない方を登録する）。

### ショップアイコンはアイテムごと

`manifest.json` の `icons` とは**別登録**。前者は Chrome のツールバーと `chrome://extensions`、
後者はストアの掲載ページと検索結果で使われる。中身は同じ `icon-128.png` でよいが、
コンソールにアップロードし直す必要がある。

アカウント共通なのは、投稿者の表示名・パブリッシャー ID・連絡先メール・Trusted Tester・住所。

## ブラウザ操作するときの注意

- **Chrome 拡張（claude-in-chrome）ではウェブストアを操作できない。**
  `chrome.google.com/webstore` と `chromewebstore.google.com` の両方で
  `The extensions gallery cannot be scripted.` になる。ブラウザ側の制限で回避策はない。
  **Browser ペーン（`mcp__Claude_Browser__*`）を使う。**
- **`computer` の座標系は呼び出しごとに揺れる**（CSS × 0.625 と × 0.3125 が入れ替わる）。
  座標クリックは当てにしない。Google の Material UI は `pointerdown` / `mousedown` で開くので、
  `javascript_tool` から対象要素に直接イベントを送るほうが確実。
- 入力欄はネイティブ setter + `input` / `change` イベントで埋める。
  **反映は文字数カウンタの更新で確認できる**（例: `説明 1,327/16,000`）。
- Google の再ログイン（本人確認）が挟まることがある。**パスワード入力はユーザーに依頼する。**

## リリース前に必ず実機で遊ぶ

初回提出のとき、掲載画像を撮る過程で実機でしか出ない不具合が 6 件出た
（破壊マスの色・見えない草の破壊・HUD の可読性と重なり・ボタンの位置・盤面の場所確保・リサイズ追従）。
`pnpm -r test` が通っていても出る種類のものだった。詳細は `tasks/todo.md` のセッション13。

**`chrome://extensions` で `apps/extension/dist` を読み込み、実際に 1 ラウンド遊んでから提出する。**
リポジトリのパスに `.claude` が含まれると macOS のファイルダイアログでは辿れないので、
`Cmd+Shift+G` でパスを貼り付けるか、デスクトップにシンボリックリンクを張る。
