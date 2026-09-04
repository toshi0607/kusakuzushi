# WebMCP 記事用メモ — Cloudflare bridge 方式(草崩し側)

目的: 「サーバー状態のあるサイト(Cloudflare `McpAgent` + `registerWebMcp()`)」と
「ブラウザ状態だけのサイト(cca-study-guide、第一者でページ内登録)」を技術記事で対比するために、
後から再確認しにくい事実と判断を日付付きで残す。cca 側の記録は
`cca-study-guide/tasks/webmcp-article-notes.md`(2026-09-02〜)。仕様の一次情報(spec commit、
Chrome の文字数予算、`@mcp-b/global` の挙動)はそちらが正で、ここには重複させない。

設計本体は `tasks/todo.md` の「WebMCP 対応 — Cloudflare bridge 方式の設計」節。

---

## 2026-09-04 調査フェーズ

### `agents/experimental/webmcp`(`agents@0.22.0`、npm 2026-08-27 公開)を読んだ事実

npm pack して `dist/experimental/webmcp.js`(9.8KB、依存込みで bundle すると別)を実読。

- **見ているグローバルは `navigator.modelContext`**。spec の正式名 `document.modelContext` ではない。
  無ければ「navigator.modelContext not available — skipping」を info ログして**通信ゼロ・空ハンドル**で返る(no-op)
  - Chromium 151(Playwright 同梱、`--enable-experimental-web-platform-features`)では両者が**同一オブジェクト**なので今は動く(実測)。
    cca メモでは `navigator.` は旧名で deprecated 予定(伝聞、要 chromestatus 確認)。名前が消えた日に bridge は静かに no-op になる — Cloudflare adapter の前方互換リスクとして記事に書く価値あり
- transport は **Streamable HTTP**(`StreamableHTTPClientTransport`、`@modelcontextprotocol/sdk` 1.30.0)。cca メモの「SSE で接続」は誤り。`watch: true`(既定)の時だけ通知受信用に GET(SSE)を張る
- `tools/list` の結果を `${prefix}${name}` で `navigator.modelContext.registerTool` に再登録。`annotations` は `readOnlyHint` だけ通す(他の hint は落ちる)
- `execute` は `tools/call` の `content[]` を **`\n` 連結の 1 文字列**にして返す。text はそのまま、image は `data:<mime>;base64,` の data URL、他は data をそのまま + warn。**JSON オブジェクトでは返らない**ので、リモートツールは text 1 本に JSON を入れる設計にする。`isError` は `Error` として throw
- `registerTool` の例外は `warn` に握って続行(= **同名衝突は無音**。docs の記述どおり)。native Chromium 151 側も同名の二重登録を黙って受理した(下記)ので、二重に無音
- 公式警告がモジュール先頭に大書き: 「EXPERIMENTAL — DO NOT USE IN PRODUCTION … pin your agents version and expect to rewrite」
- peer deps: `@modelcontextprotocol/sdk 1.30.0`、`zod ^4`(client 側で必要)。**ブラウザ bundle 実測 309KB / gzip 89KB**(esbuild `--bundle --minify`。内訳 ajv 104KB・zod 98KB・MCP SDK 66KB・agents 本体 3.7KB)。
  cca の `@mcp-b/global`(284KB / gzip 73KB)と同規模 = 「MCP プロトコル実装をブラウザに丸ごと持ち込む」コストは方式によらず同じ

### native WebMCP(Chromium 151.0.7922.34)の実測

Playwright の Chromium に `--enable-experimental-web-platform-features` を付けて本番 URL で確認。

| 項目 | 結果 |
| --- | --- |
| `typeof navigator.modelContext` / `document.modelContext` | フラグ無し: undefined / undefined。フラグ有り: object / object、**同一オブジェクト** |
| `typeof ModelContext` | フラグ有りで `function`(native) |
| `navigator.modelContextTesting` | フラグ有りで存在(`listTools` / `executeTool(name, inputJson) → string`) |
| ドット付き名 `remote.get_contribution_grid` の `registerTool` | **受理**。`listTools` に出る。`executeTool` で呼べる(戻りは JSON 文字列) |
| 同名を signal 無しでもう一度 `registerTool` | **例外なし**(spec は `InvalidStateError`)。`listTools` には 1 件のまま |
| `AbortController.abort()` | ツールが消える(`listTools` 空) |

### Cloudflare 側の前提(docs、2026-09-04 閲覧)

- **同一ゾーン内の Worker → Worker は素の `fetch` が失敗する。Service Binding が唯一の経路**
  (developers.cloudflare.com/workers/configuration/routing/custom-domains/#worker-to-worker-communication、
  workers/platform/limits/#worker-to-worker-subrequests)。`kusakuzushi-mcp` から `/share/{user}/og.png` を再利用するには `[[services]] binding="OGP" service="kusakuzushi-ogp"` が要る。
  Service Binding 経由の呼び出しは追加のリクエスト課金なし・同一スレッド実行
- **Workers Free plan で Durable Objects は SQLite backend のみ利用可**(`new_sqlite_classes`。durable-objects/platform/pricing、2026-08-25 更新)。
  McpAgent は DO 必須なので Free plan でも成立する。超過時は「そのタイプの操作がエラーになる」(課金ではない)
- Rate limit binding(`[[ratelimits]]`、2025-09-19 GA)の `namespace_id` を 2 つの Worker で共有できるかは docs で見つからず。
  今回は Service Binding 越しに ogp 側の limiter を効かせる設計で回避
- cloudflare-api MCP(claude 側コネクタ)は未認証。wrangler の OAuth token は zone **read**、workers/pages **write**。ダッシュボードのゾーン設定はボクからは触れない

### ゼロコード注入(blog 実読、2026-09-04)

- 一次情報: 「Give any website a WebMCP interface」 https://blog.cloudflare.com/webmcp/ (2026-08-06T13:00Z)。**developer preview**(「open beta」ではない)。専用 docs ページは無し。
  `developers.cloudflare.com/browser-run/features/webmcp/`(2026-04-23)は**別物**(Browser Run でサイトの WebMCP ツールを叩くエージェント側機能)。混同しない
- 仕組み(blog より): ダッシュボード **Agent Readiness > WebMCP** をオン → HTMLRewriter が全 HTML に
  `<script type="module" src="/.webmcp/bridge.js" data-packs="c2pa,mcp-server-client" data-mcp-url="/mcp"></script>` を注入。
  パックは 2 つ、どちらも既定オン・**完全にクライアント側で動き Cloudflare への往復なし**:
  `c2pa`(Content Credentials。検証は未実装で常に `signatureVerified:false`)と `mcp-server-client`(同一オリジンの MCP サーバーを「訪問者のセッションで」ページから代理呼び出し)
- `data-mcp-url` の既定が同一オリジン `/mcp`。つまり「ゼロコード」の前提は「`/mcp` に MCP サーバーが**既にある**こと」— cca メモの整理(「MCP サーバーを作ればブラウザ側はゼロコード」)が正確
- blog 本文は「Chrome 146 から実験的に出荷、`document.modelContext` として現れる」と表記(Cloudflare の SDK 側 adapter は `navigator.` を見ている — 社内でも表記が割れている)
- blog に rate limit / ツール数上限 / Pages 対応の明記なし(本文を「limit」「rate」で検索してゼロ)。HTMLRewriter 方式なのでプロキシ配信であれば静的 / SPA を問わない、という主張。Pages で効くかは INFERRED
- 草崩し側の含意: (1) 有効化はダッシュボード操作(ボクからは不可)。(2) **全 HTML にスクリプトが注入される = Lighthouse の `script:size ≤ 40KB` 予算に直撃する可能性**。オンにするなら計測して戻す

### `agents` の履歴・doc と code の食い違い(cloudflare/agents @ec93caf、2026-09-03)

- `registerWebMcp` は `agents@0.11.4`(2026-04-18、PR #1222)で導入。現行 0.22.0
- 同名衝突: docs(`experimental/webmcp.md`)は「silent」と書くが、code は `registerTool` の例外を `logger.warn` する(既定 logger は console)。`quiet:true` の時だけ本当に無音。spec 側(webmachinelearning/webmcp#101 → PR #132)は「重複名は throw」— でも Chromium 151 の実測は throw しなかった(上表)。**docs / spec / 実装の 3 者が一致していない**
- docs の Open Questions: 「WebMCP の `execute` は単一値、MCP は tasks でストリーミング — bridging は unexplored」(= ストリーミング非対応の一次情報)
- SSR: docs 明記 + code は `navigator.modelContext` を無条件に読むので Node で `ReferenceError`
- `McpAgent` の最小構成は `examples/webmcp/`(`wrangler.jsonc`: `nodejs_compat`、`durable_objects.bindings`、`migrations.new_sqlite_classes`、`MyMCP.serve("/mcp", { binding })`)。`serveSSE()` は legacy
- `@mcp-b/global` README: 「native があれば wrap、無ければ polyfill を入れて wrap」(置換ではない)

### Chrome の状況(二次資料の相互裏取り、chromestatus 直読はしていない)

- Chrome 146 でフラグ(`chrome://flags/#enable-webmcp-testing`)実装 → **149〜156 が Origin Trial**(Google I/O 2026-05-19 発表)→ 150 で `navigator.modelContext` は deprecated alias(console warn 1 回)
- `navigator` → `document` の rename 日付は 2026-05-27 / 08-10 で資料が割れて未解決。記事に書くなら spec の commit log を引く

### この設計で cca と分かれた点(記事の対比軸)

| 観点 | cca-study-guide(第一者) | 草崩し(Cloudflare bridge) |
| --- | --- | --- |
| 価値の在処 | localStorage の学習進捗 | サーバーでしかできない処理(OGP レンダリング、草データ取得) |
| 到達経路 | ページ内 + `@mcp-b/global` bridge → 拡張 → Claude | ページ内(native のみ)+ **Claude Code から `/mcp` を直接**(ブラウザ不要) |
| polyfill / bridge の同梱 | `@mcp-b/global` を常時遅延ロード(73KB gz) | **入れない**。Lighthouse の `script:size ≤ 40KB` が error のため、native が無い環境で 1 バイトも落とさない設計(Cloudflare bridge 自体も native 無しでは no-op) |
| ツール結果の形 | JSON オブジェクト | ページ内は JSON オブジェクト、リモートは bridge が平坦化した**文字列**(混在) |
| 出力予算の測り方 | `JSON.stringify(result).length` | 同じ + リモートは `content[].text` を `\n` 連結した最終文字列 |
| 書き込み | ゼロ(推移的にも) | ページ状態の変更は `start_game` のみ。ストレージ・DO・KV には書かない。`render_share_card` はエッジキャッシュを温める(= readOnlyHint は自己申告、の例) |
| 実行主体 | ブラウザ(ページの JS) | Worker(DO)。ページはプロキシ |
| 状態の所在の記事上の意味 | 「ブラウザにしか無い状態」をエージェントへ | 「サーバーにしか無い能力」をエージェントへ |

### 未取得・要確認(記事執筆までに埋める)

- chromestatus / spec commit log で `navigator` → `document` rename の確定日
- `McpAgent` が GET `/mcp` に何を返すか(SSE を開くのか 405 か) — `watch:false` にする根拠の実測
- ゼロコード注入の `/.webmcp/bridge.js` の実サイズ・参照グローバル(有効化はトシの操作待ち)

## 実装中の記録(追記していく)

### 2026-09-04 設計確定(トシ回答)

- leaderboard なし(サーバー状態を持たない原則を維持)/ `@mcp-b/global` なし(Lighthouse `script:size ≤ 40KB` が理由)/ `apps/web` の草取得は同 PR で自 Worker 経由に切替 / ゼロコード注入は「オン → 計測 → オフ」で試す
- 分担: `workers/ogp` が「サーバー側の能力」(レンダリング + 草データ取得口 `/api/grid/{user}`)を持ち、`workers/mcp` は `McpAgent` の façade として Service Binding で ogp を叩くだけ。限界値(rate limit)と Cache API は全部 plain Worker 側(ogp)— DO 内で binding が効くかを検証しなくて済む設計にした
- エージェント経由のレンダリングは `x-kusakuzushi-via: mcp` ヘッダで別枠(10/60s)を先に通す。理由: ogp の limiter は global key 1 本なので、エージェントのループが本物のクローラー(X/Slack)の共有カードを 429 にする
- レビュー(2026-09-04)で「**草データを Worker 経由にした瞬間、limiter のキー設計が『誰が誰を止められるか』の問題になる**」が出た: global key だと 1 クライアントの連打が全プレイヤーを 429 にする(直叩き時代には無かった退行)、via ヘッダは自己申告なので偽装で枠を枯らせる。キーをクライアント IP にして解消。記事の「サーバーを持つと増える責任」の具体例

### 2026-09-04 実装(手元で全部通した段階。PR / 本番はまだ)

- 分担の最終形: `workers/ogp` が `/share/*` と **`/api/grid/{user}`**(jogruber の検証済み JSON 素通し、Cache API 10 分、limiter 60/分)、`workers/mcp` は `McpAgent` の façade で両ツールとも Service Binding で ogp を叩くだけ。DO 内では Cache も limiter も呼ばない
- **`McpAgent` は agents 0.22.0 の型定義で `@deprecated`**(「feature-frozen。`createMcpHandler` + SDK v2 factory へ移行」)。`registerWebMcp` の公式 example(`examples/webmcp`)はまだ `McpAgent` を使っている。今回は sessionful な DO の形が実験対象なので exact pin で採用。記事では「Cloudflare 内でも MCP サーバーの推奨 API が 2026 年中に動いた」事実として書ける
- workerd の制約: Worker の entry module から**定数を `export` すると起動拒否**(「map entry 'VIA_HEADER' is not of type 'function or ExportedHandler'」)。entry の export はハンドラと DO クラスだけ
- `wrangler dev` の複数構成(`-c mcp -c ogp`)は Service Binding が `[not connected]` 表示でも実際には通った。ただし secondary はポートに出ないので、ページが `/api` を叩く E2E では **ogp と mcp を別ポートの 2 セッション**にし、wrangler のローカルレジストリで binding を接続(`[connected]` 実測)
- ローカル実測(`tools/verify-mcp.mjs`、素の Streamable HTTP): `initialize` 200(`mcp-session-id` 付与)→ `notifications/initialized` 202 → `tools/list` → `tools/call` ×2 → `DELETE` 204。GET `/mcp` は Session-Id 無しで 400、`accept` 無しで 406(= `watch:true` が張る SSE は Session-Id 付き GET)
- **Chromium 151 の `navigator.modelContextTesting.executeTool` は、ツールが文字列を返すとそのまま、オブジェクトを返すと JSON 文字列にして返す**(probe3)。bridge が `content[]` を平坦化した「JSON の文字列」と、ページ内ツールの「オブジェクト」は runner 越しには区別できない。E2E は最終文字列の予算と復号後の形だけを固定した
- `document.modelContext.executeTool(tool, {})` は native に存在するが `UnknownError: Failed to parse input arguments`(JSON 文字列を期待?未追跡)。`getTools()` の要素は `{description, name, origin, title, window}` で `execute` は持たない(= ページからは testing API 経由でしか呼べない)
- 遅延チャンク実測(Vite 8.2.2): `register-*.js` **295,039 B / gzip 83,252 B**(agents adapter + `@modelcontextprotocol/sdk` 1.30 + zod 4.5 + ajv)。eager `index-*.js` は gzip 11,589 B(マーカー `webmcp-adapter` 不在)
- Lighthouse(`pnpm lh`、dist、5 runs、Chrome にフラグ無し): perf 中央値 100(1 回だけ 0.84 のノイズ)、**`resource-summary` script 転送 12,353 B**(予算 40,000 B)、total 200,091 B。WebMCP モジュールは 1 バイトも乗らない(gate spec `e2e/webmcp-gate.spec.ts` で固定)
- E2E(`pnpm test:e2e`、Playwright 1.62.1、Chromium 151 + `--enable-experimental-web-platform-features`): 6 passed / 14.7s。内容: 4 ツールの列挙 / bridge 経由 `remote.get_contribution_grid`(実 jogruber)/ 不正 user の両側拒否と非 echo / `start_game` → `ready` → Space で `playing` → 再 `start_game` 拒否 → ストレージ(local/session/cookie/IndexedDB 名)バイト同一 + 同一オリジンと Google Fonts 以外への通信ゼロ / `remote.render_share_card`(Service Binding 越しの実レンダリング、`data:image` 不在、1.5K 以内)/ フラグ無し Chromium で WebMCP チャンク未ロード
- ユニット: core 70 / ogp 121(+18: `/api/grid` 8、via:mcp 5、github-grid 5)/ web 98(+5)/ extension 80 / mcp 10 = 379 passed。`pnpm -r build` 6 パッケージ Done
- 本番(2026-09-04、PR #74 → merge b3bbd87): GitHub Actions の `e2e` job は初回で pass(2 本の `wrangler dev` がレジストリ経由で Service Binding を接続できた、1m11s)。deploy-ogp → deploy-mcp(DO namespace 初回作成込み 54s)/ deploy-web → verify-webmcp(本番ページ + フラグ付き Chromium、7m44s)まで success。手元からの `verify:mcp` は本番で「他オリジン 403 / Origin 無しに CORS ヘッダ無し / 自オリジンの `Access-Control-Allow-Origin` が厳密に `https://kusakuzushi.toshi0607.com`」を確認 → 上の「wrangler dev が route ホストを読み替える」は本番では起きない(VERIFIED)
- 未実施: Claude Code からの `claude mcp add --transport http`(トシの作業)、ゼロコード注入(トシのダッシュボード操作 → 計測 → オフ)、ベンチ(native WebMCP を出した Chrome + エージェントで、ツールあり/なし)

### 2026-09-04 レビューで判明した Cloudflare 側の既定(記事の「制約」章)

- **`McpAgent.serve()` は既定で全応答に `Access-Control-Allow-Origin: *` と `Access-Control-Expose-Headers: mcp-session-id` を付け、OPTIONS にも 200 を返す**(agents 0.22.0 `dist/mcp/index.js`、reviewer が curl で実測)。つまり「WebMCP のブリッジが同一オリジンで `/mcp` を叩く」ために必要なのは CORS ではないのに、SDK は世界中のページから叩ける形で出荷する。`corsOptions` で origin は絞れるが、SDK はヘッダを付けるだけで**サーバー側で拒否はしない**。今回は wrapper で `Origin` allowlist(403)+ Origin 無しには CORS ヘッダを付けない形にした。MCP 仕様の Streamable HTTP が求める Origin 検証(DNS rebinding 対策)を SDK 任せにできない例
- `initialize` は Durable Object を割り当てて `initializeRequest` / `props` を SQLite に書く。DELETE しない client(bridge は dispose で DELETE するが、途中でタブを閉じれば残る)の分は残骸として残り、掃除は無い。ツール結果の event store は POST 応答後に `clearStream` される(= ツールが状態を残さないという設計の前提はここでは成立)
- GET `/mcp` は Session-Id 付きなら SSE を開いて DO を接続の寿命ぶん掴む。`watch:false` のブリッジには不要なので wrapper で 405
- 「サーバーを持つ」と増える責任の具体例(cca には無かった論点): CORS の既定、DO の残骸、limiter のキー設計(global → 誰でも全員を止められる)、上流障害とデプロイ連鎖の切り離し
- **wrangler dev は自分のローカルオリジン(`http://127.0.0.1:8787`)と route ホスト(`kusakuzushi.toshi0607.com`)を双方向に読み替える**: `Origin: http://127.0.0.1:8787` を送ると Worker には別の値で届く(許可リストに入れても 403)、逆に Worker が set した route ホストの `Access-Control-Allow-Origin` は curl にはローカルホストで見える。別ポートの Vite preview(4173)のオリジンは読み替えられず、ACAO も厳密値で返った(実測)。`--var ALLOWED_ORIGINS:<url>` は URL のまま正しく渡る(本番オリジンを渡した回は 200 / 偽装 403 だった)。ローカルの許可オリジンは `workers/mcp/.dev.vars`(コミット済み、秘密ではない)にまとめ、本番の「自オリジンが許可され `*` ではない」は `verify-mcp.mjs` が https のときだけ検査する

### 2026-09-04 ダッシュボードの実物(Agent Readiness > WebMCP、Beta)

- 場所: ゾーン(`toshi0607.com`)配下の **Agent Readiness > WebMCP**(URL `/<account>/<zone>/agent-readiness/webmcp`)。バッジは「Beta」、説明は「Experimental, opt-in features for making your site work better with AI agents.」
- 構成: 「Configuration: WebMCP bridge is off」の状態行、「Enable WebMCP — Injects a lightweight WebMCP bridge into your site's HTML so browser-based AI agents can read and interact with your pages.」、Tool packs(Optional)に **Content Credentials (C2PA)** と **Site MCP server(Proxies your site's own MCP server tools to the in-browser agent)** の 2 トグル。**ダッシュボードではどちらのパックも既定オフ**(blog の「両方既定オン」とは違う)。MCP サーバー URL の入力欄は無い(= 同一オリジン `/mcp` 固定で、blog の `data-mcp-url` 既定に一致)。「View Docs」は docs ではなく blog(https://blog.cloudflare.com/webmcp/)に飛ぶ
- 影響範囲の注意: 設定は**ゾーン単位**。`toshi0607.com` 配下でプロキシ配信している HTML 全部(kusakuzushi 以外のサブドメインも)に注入される

### 2026-09-04 ゼロコード注入を本番でオンにして計測(Site MCP server パックのみ、C2PA オフ)

- 注入タグ(トップページ HTML、実測): `<script type="module" src="https://kusakuzushi.toshi0607.com/.webmcp/bridge.js" data-packs="mcp-server-client">`。blog の例と違い `data-mcp-url` は無く(既定の同一オリジン `/mcp`)、`src` は絶対 URL
- `/.webmcp/bridge.js`: **47,612 B / gzip 13,403 B**、`text/javascript`、`cache-control: public, max-age=0, must-revalidate`、import なしの単一ファイル。`navigator.modelContext` と `document.modelContext` の両方を参照(deprecation warning が 1 回出る)。内部名は `[webmcp-interceptor]`
- **フラグ無しの Chromium にも無条件に読み込まれる**(script 一覧: `/.webmcp/bridge.js`、`index-*.js`、Cloudflare beacon)。native が無い環境で 1 バイトも読まない D1/D2 の設計とは正反対。Lighthouse の予算への影響は下記
- **フラグ有りでも注入ブリッジ由来のツールはゼロ**。`listTools()` に並ぶのはボクらの 4 つ(`get_game_state` / `start_game` / `remote.*`)だけ。コンソール: `[webmcp-interceptor] mcp-server-client: tools/list failed for "/mcp"; registering no site tools. Error: MCP endpoint returned HTTP 400` → `Registered 0 dynamic tool(s) from 1 dynamic pack(s).`
- 原因(ワイヤ実測): 注入ブリッジの MCP クライアント(`mcpRpc`)は **`initialize` を送らず、`Mcp-Session-Id` も付けずに、いきなり `POST /mcp {"method":"tools/list"}`**(`accept: application/json, text/event-stream`、`credentials: "same-origin"` = ログイン Cookie で認証する前提、応答は 8 MB 上限・20 ページまで)。`McpAgent`(sessionful な Streamable HTTP)は「Mcp-Session-Id header is required」の 400 を返す。**ゼロコード注入が想定する「site MCP server」はセッションレス(`createMcpHandler` + SDK v2 factory)の形で、feature-frozen の `McpAgent` とは噛み合わない** — Cloudflare 内で MCP サーバーの推奨 API が動いたことの、もう一つの現れ
- 一方ボクらの `registerWebMcp()` は同じ `/mcp` に `initialize` → `notifications/initialized` → GET(SSE、SDK の client が `watch:false` でも自動で開こうとする → wrapper の 405、SDK は仕様どおり無視)→ `tools/list`(sid 付き)で通る。同じページに 2 つの Cloudflare 製ブリッジが同居し、片方だけが動いた
- 影響: ゾーン単位なので `toshi0607.com` 配下の全 HTML に 13.4 KB gz が乗る。ページ側の挙動は変わらない(失敗は warn どまり)
- `pnpm lh:prod`(注入オン、5 runs、2026-09-04): perf 中央値 **100**、FCP/LCP 1,071 ms、`resource-summary` **script 転送 37,096〜37,109 B**(予算 40,000 B に対し残り約 2.9 KB。内訳の推定: entry 12.4 KB + 注入 bridge 13.4 KB + Cloudflare Web Analytics beacon ≈ 11 KB)、total ≈ 226.7 KB。`uses-long-cache-ttl` が warn(bridge.js が `max-age=0, must-revalidate`)。予算内には収まったが、ゼロコード注入 1 つでページの残り予算をほぼ使い切る
- オフに戻した直後(同日): トップページ HTML から注入タグは消えた。`/.webmcp/bridge.js` 自体はオフ後も 200 で配信され続ける(パスは Cloudflare が予約している模様)
- 次の実験(トシ指示「実験つづけて」): `/mcp` を Cloudflare 推奨のセッションレス(`createMcpHandler` + SDK v2 factory)に置き換え、注入ブリッジの `tools/list`(initialize 無し)が通るかを再計測する

### 2026-09-04 実験 2: `/mcp` をセッションレスに置き換え

- `agents/mcp/server` の `createMcpHandler(factory, options)`(= `createStatelessMcpHandler`)。factory は `(ctx: McpRequestContext) => McpServer` で **ctx に env は無い**(`era`/`authInfo`/`requestInfo` のみ)→ 最初のリクエストの `env.OGP` を閉じ込めてハンドラを isolate ごとに 1 回生成
- SDK v2(`@modelcontextprotocol/server@2.0.0`)の `registerTool` は `inputSchema` に **Standard Schema(zod 4 の `z.object(...)` そのもの)** を取る(v1 は raw shape)。結果の形(`content[].text` / `isError`)は同じで `tools.ts` は無変更
- handler オプション: `legacy: "stateless"`(2025 系の非エンベロープ通信を「各リクエストごとに新しいインスタンスで、sessionIdGenerator 無し」で捌く。GET/DELETE は 405)、`corsOptions: false` + `allowedOriginHostnames: "*"`(Origin 検証は wrapper で済ませている旨を宣言)。handler 自体に `allowedHostnames` / `allowedOriginHostnames` があり、`McpAgent.serve` の「`*` を無条件に付ける」既定とは対照的
- Durable Object を撤去(`[[migrations]] tag="v2" deleted_classes`)。セッションの残骸問題(reviewer Medium 1)も消える
- ローカル実測: initialize 無し・セッション無しの `POST /mcp tools/list` → 200(SSE、2 ツール)。`verify-mcp.mjs` に「cold tools/list」分岐を追加してフル pass。E2E(ページの `registerWebMcp` は initialize から通す形のまま)も通過

