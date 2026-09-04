/**
 * MCP Worker のデプロイ後スモークチェック。
 *
 * `/mcp` は Streamable HTTP の MCP エンドポイント(workers/mcp)。route が外れると
 * Pages が index.html を **200** で返すので、ステータスでは判定できない。
 * MCP のハンドシェイクを素の fetch で最後まで通し、ツールが実際に答えることを見る:
 *
 *   0. initialize 無しの tools/list → 200 で 2 ツール(Cloudflare のゼロコード注入ブリッジが投げる形。
 *      セッションレスなサーバーでだけ通る)
 *   1. initialize        → 200、serverInfo.name が kusakuzushi(セッションレスなので `mcp-session-id` は無くてよい)
 *   2. tools/list        → get_contribution_grid と render_share_card の 2 つ
 *   3. tools/call get_contribution_grid {user} → isError なし、text が JSON で weeks 53 本、1.5K 字以内
 *   4. tools/call render_share_card {user, percentage} → isError なし、imageUrl が /share/{user}/og.png
 *      (エージェント向けの描画枠は 10/分。一度通ったら以降のリトライでは呼ばず、枠切れの isError は
 *      「route も Worker も生きている」証拠として通す — 本物のエージェントの枠を検証で食い潰さない)
 *   5. DELETE(セッション終了)→ 2xx か 405(実装依存なので両方許す)
 *   6. オリジン制限: 他オリジンの Origin → 403、Origin 無し → CORS ヘッダ無し(Claude Code 等)、
 *      自オリジン → Access-Control-Allow-Origin が `*` ではなく自オリジン(本番 = https のときだけ。
 *      wrangler dev は自分のローカルオリジンを route ホストに読み替えるので、ローカルでは検査できない)
 *
 * レスポンスは JSON か SSE(text/event-stream)のどちらかで来る。両方読む。
 *
 *   node tools/verify-mcp.mjs [--origin https://kusakuzushi.toshi0607.com]
 *                             [--user toshi0607] [--attempts 10] [--interval 6000]
 */
const DEFAULTS = {
  origin: "https://kusakuzushi.toshi0607.com",
  user: "toshi0607",
  attempts: 10,
  interval: 6000,
};

const TOOL_OUTPUT_CHAR_LIMIT = 1500;
const EXPECTED_TOOLS = ["get_contribution_grid", "render_share_card"];

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in DEFAULTS)) {
      throw new Error(`unknown option: ${argv[i]}`);
    }
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`missing value for ${argv[i]}`);
    }
    if (typeof DEFAULTS[key] === "number") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${argv[i]} には正の数を渡すこと(受け取った値: ${value})`);
      }
      options[key] = parsed;
    } else {
      options[key] = value;
    }
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** JSON でも SSE でも、最初の JSON-RPC レスポンスを取り出す。 */
async function readRpcResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (contentType.includes("text/event-stream")) {
    for (const line of body.split("\n")) {
      if (line.startsWith("data:")) {
        const message = JSON.parse(line.slice(5).trim());
        if (message.result !== undefined || message.error !== undefined) {
          return message;
        }
      }
    }
    throw new Error("SSE に JSON-RPC レスポンスが無い");
  }
  if (!contentType.includes("application/json")) {
    throw new Error(`MCP の応答が JSON でも SSE でもない: ${contentType || "(無し)"}(HTML なら route が外れている)`);
  }
  return JSON.parse(body);
}

class McpSmoke {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.sessionId = null;
    this.nextId = 1;
  }

  async post(payload, expectResult = true) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }
    const response = await fetch(this.endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }
    if (!expectResult) {
      return response;
    }
    if (response.status !== 200) {
      throw new Error(`${payload.method} が HTTP ${response.status}`);
    }
    const message = await readRpcResponse(response);
    if (message.error) {
      throw new Error(`${payload.method} がエラー: ${JSON.stringify(message.error)}`);
    }
    return message.result;
  }

  request(method, params) {
    return this.post({ jsonrpc: "2.0", id: this.nextId++, method, params });
  }

  notify(method, params) {
    return this.post({ jsonrpc: "2.0", method, params }, false);
  }

  async close() {
    if (!this.sessionId) return null;
    return fetch(this.endpoint, { method: "DELETE", headers: { "mcp-session-id": this.sessionId } });
  }
}

/** 一度でも render_share_card が通ったら以降の attempt では呼ばない(10/分の枠を検証で使い切らない)。 */
let renderVerified = false;

/** オリジン制限の 3 分岐。SDK の既定(Access-Control-Allow-Origin: *)が wrapper で潰されていることを見る。 */
async function checkOriginPolicy(endpoint, origin) {
  const initialize = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-mcp", version: "0.0.0" } },
  });
  const post = (headers) =>
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: initialize,
    });

  const foreign = await post({ origin: "https://evil.example" });
  if (foreign.status !== 403) {
    return `他オリジンからの /mcp が HTTP ${foreign.status}(403 のはず)`;
  }

  const headless = await post({});
  if (headless.headers.get("access-control-allow-origin") !== null) {
    return `Origin 無しの応答に access-control-allow-origin が付いている: ${headless.headers.get("access-control-allow-origin")}`;
  }
  await fetch(endpoint, { method: "DELETE", headers: { "mcp-session-id": headless.headers.get("mcp-session-id") ?? "" } }).catch(() => undefined);

  // wrangler dev は自分のローカルオリジン(http://127.0.0.1:8787)を route ホストに読み替えるので、
  // 「自オリジンが許可される」は本番(https)でだけ検査できる
  if (!origin.startsWith("https://")) {
    console.log("  (注意) ローカルなので自オリジンの許可検査は省略(本番でのみ検査)");
    return null;
  }
  const own = await post({ origin });
  if (own.status !== 200) {
    return `自オリジンからの /mcp が HTTP ${own.status}`;
  }
  const allowed = own.headers.get("access-control-allow-origin");
  if (allowed !== origin) {
    return `自オリジンへの応答の access-control-allow-origin が ${allowed ?? "(無し)"}(${origin} のはず。* なら SDK の既定が潰れていない)`;
  }
  await fetch(endpoint, { method: "DELETE", headers: { "mcp-session-id": own.headers.get("mcp-session-id") ?? "" } }).catch(() => undefined);
  return null;
}

/** 全部通れば null、駄目なら理由の文字列を返す。 */
async function checkOnce(endpoint, user) {
  const originPolicy = await checkOriginPolicy(endpoint, new URL(endpoint).origin);
  if (originPolicy !== null) {
    return originPolicy;
  }

  // 注入ブリッジと同じ順番: いきなり tools/list(initialize もセッションも無し)
  const cold = new McpSmoke(endpoint);
  const coldList = await cold.request("tools/list", {});
  const coldNames = (coldList?.tools ?? []).map((tool) => tool.name).sort();
  if (JSON.stringify(coldNames) !== JSON.stringify(EXPECTED_TOOLS)) {
    return `initialize 無しの tools/list が ${JSON.stringify(coldNames)}(期待: ${JSON.stringify(EXPECTED_TOOLS)})`;
  }

  const mcp = new McpSmoke(endpoint);
  try {
    const init = await mcp.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "verify-mcp", version: "0.0.0" },
    });
    if (init?.serverInfo?.name !== "kusakuzushi") {
      return `initialize の serverInfo.name が ${init?.serverInfo?.name ?? "(無し)"}`;
    }
    await mcp.notify("notifications/initialized", {});

    const list = await mcp.request("tools/list", {});
    const names = (list?.tools ?? []).map((tool) => tool.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(EXPECTED_TOOLS)) {
      return `tools/list が ${JSON.stringify(names)}(期待: ${JSON.stringify(EXPECTED_TOOLS)})`;
    }

    const grid = await mcp.request("tools/call", { name: "get_contribution_grid", arguments: { user } });
    if (grid?.isError) {
      return `get_contribution_grid が isError: ${grid.content?.[0]?.text}`;
    }
    const gridText = grid?.content?.[0]?.text ?? "";
    if (gridText.length > TOOL_OUTPUT_CHAR_LIMIT) {
      return `get_contribution_grid の出力が ${gridText.length} 字(上限 ${TOOL_OUTPUT_CHAR_LIMIT})`;
    }
    let parsedGrid;
    try {
      parsedGrid = JSON.parse(gridText);
    } catch {
      return "get_contribution_grid の text が JSON ではない";
    }
    if (!Array.isArray(parsedGrid.weeks) || parsedGrid.weeks.length < 52 || parsedGrid.weeks.length > 53) {
      return `get_contribution_grid の weeks が ${parsedGrid.weeks?.length ?? "(無し)"} 本`;
    }

    if (!renderVerified) {
      const card = await mcp.request("tools/call", { name: "render_share_card", arguments: { user, percentage: 56, score: 1234 } });
      const cardText = card?.content?.[0]?.text ?? "";
      if (card?.isError && cardText.includes("rate limited")) {
        console.log("  (注意) render_share_card がレート制限中: route と Worker は生きているので通す");
      } else {
        if (card?.isError) {
          return `render_share_card が isError: ${cardText}`;
        }
        if (cardText.length > TOOL_OUTPUT_CHAR_LIMIT) {
          return `render_share_card の出力が ${cardText.length} 字(上限 ${TOOL_OUTPUT_CHAR_LIMIT})`;
        }
        const parsedCard = JSON.parse(cardText);
        if (!String(parsedCard.imageUrl).includes(`/share/${encodeURIComponent(user)}/og.png?`)) {
          return `render_share_card の imageUrl が ${parsedCard.imageUrl}`;
        }
        if (!String(parsedCard.imageContentType).includes("image/png") || !(parsedCard.imageBytes > 0)) {
          return `render_share_card の画像が ${parsedCard.imageContentType} / ${parsedCard.imageBytes} bytes`;
        }
      }
      renderVerified = true;
    }

    const closed = await mcp.close();
    if (closed && !(closed.ok || closed.status === 405)) {
      return `DELETE が HTTP ${closed.status}`;
    }
    return null;
  } finally {
    await mcp.close().catch(() => undefined);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const endpoint = `${options.origin}/mcp`;
  console.log(`verify-mcp: ${endpoint}`);

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    let reason;
    try {
      reason = await checkOnce(endpoint, options.user);
    } catch (error) {
      reason = `取得に失敗: ${error?.cause?.code ?? error?.cause?.message ?? error?.message ?? error}`;
    }
    if (reason === null) {
      console.log(`✅ /mcp が Worker に届いている(${attempt} 回目で成功)`);
      console.log("   initialize 無しの tools/list(注入ブリッジの形)→ 2 ツール");
      console.log("   initialize → tools/list(2 ツール)→ get_contribution_grid / render_share_card が 1.5K 字以内で答えた");
      console.log("   他オリジン → 403 / Origin 無し → CORS ヘッダ無し / 自オリジン → * ではない");
      return;
    }
    console.log(`  [${attempt}/${options.attempts}] ${reason}`);
    if (attempt < options.attempts) {
      await sleep(options.interval);
    }
  }

  console.error(`❌ ${options.attempts} 回試して通らなかった。デプロイは済んでいるので route か Worker 本体を疑う。`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
