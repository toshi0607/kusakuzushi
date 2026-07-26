# セキュリティポリシー

## 報告方法

**公開の Issue や PR には書かないでください。** 直っていない問題が、直る前に読める場所に出てしまいます。

GitHub の非公開報告を使ってください。作者にだけ届き、修正が出るまで公開されません。

**→ [脆弱性を報告する](https://github.com/toshi0607/kusakuzushi/security/advisories/new)**

(リポジトリの **Security** タブ → **Report a vulnerability** からも同じ画面に行けます)

書いてもらえると助かること: 再現手順、影響、確認した環境(ブラウザ / 拡張のバージョン)。
動く PoC があれば添えてください。無くても報告はしてもらって構いません。

個人が趣味で作っているプロジェクトなので、SLA はありません。数日のうちに一次返信をします。
返信が来ない場合は [@toshi0607](https://github.com/toshi0607) に GitHub 上で連絡してください。
修正が出たら、希望があればアドバイザリのクレジットに名前を入れます。

## 対象

| 対象 | 範囲 |
|---|---|
| Web 版 | https://kusakuzushi.toshi0607.com とその成果物(`apps/web`) |
| OGP Worker | `https://kusakuzushi.toshi0607.com/share/*`(`workers/ogp`) |
| Chrome 拡張 | `apps/extension`(GitHub のページ上で動く content script) |
| ゲームエンジン | `packages/core` |

対象外:

- **第三者のサービスそのもの** — GitHub、Cloudflare、および Web 版が使っている
  非公式 API [github-contributions-api.jogruber.de](https://github-contributions-api.jogruber.de)。
  それぞれの提供元へ報告してください。ただし「このリポジトリのコードがそれらを危険な使い方をしている」は対象です
- **負荷試験・DoS** — 本番に対して行わないでください。共有ホスティング上で動いています
- ソーシャルエンジニアリング、物理的アクセス、作者アカウントへの攻撃

## 前提として知っておくと切り分けが早いこと

このプロジェクトは**アカウントも認証もサーバー側の保存も持ちません**。ログイン機構、
セッション、データベース、ユーザーデータの保管はどこにもありません。

- 入力されるユーザー名は GitHub 上の公開情報で、Web 版はそれを第三者 API に問い合わせるだけです
- Chrome 拡張は**通信を一切行いません**。草の読み取りと描画はブラウザの中だけで完結し、
  外部送信・解析・Cookie・`chrome.storage` のいずれも使いません。マニフェストには
  `permissions` も `host_permissions` も無く、content script の match が
  `https://github.com/*` だけです([プライバシーポリシー](https://kusakuzushi.toshi0607.com/privacy/))
- 拡張が変えるのは表示だけで、GitHub 上のデータには書き込みません。再読み込みで元に戻ります

そのため想定される問題は、認証やデータ漏洩よりも **XSS / DOM インジェクション**
(ユーザー名や URL パラメータが GitHub のページや OGP HTML に流れ込む経路)、
**Worker のパラメータ処理**、**依存パッケージ**のあたりに寄ります。

## 依存パッケージ

依存の更新は Dependabot が毎週 PR を出します([`.github/dependabot.yml`](.github/dependabot.yml))。
GitHub Actions はサードパーティのものをフルコミット SHA で固定しています。

既知の脆弱性がある依存を見つけた場合も、上の非公開報告で構いません
(単なるバージョン上げで済むものは、通常の Issue や PR でも歓迎します)。
