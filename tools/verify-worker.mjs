/**
 * OGP Worker のデプロイ後スモークチェック。
 *
 * Worker は「route が張れているか」と「中身が正しいか」が別々に壊れうる:
 *
 *   - route(`kusakuzushi.toshi0607.com/share/*`)が外れると、Pages 側が
 *     存在しないパスに index.html を **200** で返す(セッション9 で robots.txt が
 *     これに化けた)。つまり *200 が返ってくること* は route の証明にならない
 *   - route が生きていても、UA 判定や画像生成だけが壊れることがある
 *
 * なので観測できる 4 つの分岐をそれぞれ叩く:
 *
 *   1. 非クローラー UA → 302(人間はアプリ本体へ飛ばされる)
 *   2. クローラー UA   → 200 かつ og:image を含む HTML
 *   3. og.png          → 200 かつ image/png
 *   4. `s` を持たない共有リンク(= 拡張から。DESIGN.md §5)→ スコアを一切名乗らない
 *
 * 1 が 200 なら Pages に食われている(= route が外れた)と一発で分かる。
 * 4 は「`s` が無ければスコア行を出さない」を本番で確かめる。ここが壊れると、
 * 拡張から共有されたリンクが「100% 刈り取ってスコア 0」のカードを配る。
 *
 *   node tools/verify-worker.mjs [--origin https://kusakuzushi.toshi0607.com]
 *                                [--user toshi0607] [--attempts 10] [--interval 6000]
 */
const DEFAULTS = {
  origin: "https://kusakuzushi.toshi0607.com",
  user: "toshi0607",
  attempts: 10,
  interval: 6000,
};

/** 実クローラーの UA。`isCrawlerUserAgent` は "bot" を部分一致で拾う(crawler.ts)。 */
const CRAWLER_USER_AGENT = "Twitterbot/1.0";
/** クローラー判定に引っかからない UA。ここが 302 にならないと route が疑わしい。 */
const HUMAN_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

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
      // NaN を通すと `attempt <= NaN` が常に false になり、1 度も検証せずに
      // 「N 回試して駄目だった」と嘘の理由で落ちる
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fetchAs(url, userAgent, redirect = "manual") {
  return fetch(url, {
    redirect,
    cache: "no-store",
    headers: { "user-agent": userAgent, "cache-control": "no-cache" },
  });
}

/**
 * 拡張の共有リンク(`p` だけ)がスコアを名乗らないことを見る。駄目なら理由の文字列。
 *
 * 見るのはカード HTML 側:og:description と、クローラーが辿る og:image / og:url に
 * `s=` が混じっていないこと。PNG 本体の文字は取り出せないので、`s` を落として
 * いるかどうかは URL で見る(og.png?s= が付いていればカードにスコアが焼かれる)。
 */
async function checkScorelessShare(url) {
  const response = await fetchAs(url, CRAWLER_USER_AGENT);
  if (response.status !== 200) {
    return `s なしの共有リンクが HTTP ${response.status}`;
  }
  const html = await response.text();
  if (html.includes("スコア")) {
    return "s を持たない共有リンクのカードがスコアを名乗っている";
  }
  const advertised = [...html.matchAll(/content="([^"]*\/share\/[^"]*)"/g)].map(([, value]) => value);
  if (advertised.length === 0) {
    return "s なしの共有リンクの HTML に /share/ を指す og タグが無い";
  }
  const withScore = advertised.find((value) => value.includes("s="));
  if (withScore) {
    return `s なしのはずの共有リンクが s 付き URL を広告している: ${withScore}`;
  }
  return null;
}

/** 全部通れば null、駄目なら理由の文字列を返す。 */
async function checkOnce(shareUrl, imageUrl, scorelessShareUrl) {
  const human = await fetchAs(shareUrl, HUMAN_USER_AGENT);
  if (human.status !== 302) {
    // 200 なら Pages の「存在しないパスに index.html」に食われている疑いが濃い
    return `人間 UA が ${human.status}(302 のはず。200 なら route が外れている)`;
  }

  const crawler = await fetchAs(shareUrl, CRAWLER_USER_AGENT);
  if (crawler.status !== 200) {
    return `クローラー UA が HTTP ${crawler.status}`;
  }
  const html = await crawler.text();
  // `property="og:image"` だけで見ると `og:image:width`(ogp-page.ts)にも部分一致してしまい、
  // 画像本体のタグが消えても気づけない。content 属性まで含めて見る
  if (!html.includes('property="og:image" content="')) {
    return "クローラー UA のレスポンスに og:image タグが無い";
  }

  const image = await fetchAs(imageUrl, CRAWLER_USER_AGENT);
  if (image.status !== 200) {
    return `og.png が HTTP ${image.status}`;
  }
  const contentType = image.headers.get("content-type") ?? "";
  if (!contentType.includes("image/png")) {
    return `og.png の content-type が ${contentType || "(無し)"}`;
  }

  return await checkScorelessShare(scorelessShareUrl);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const user = encodeURIComponent(options.user);
  const shareUrl = `${options.origin}/share/${user}?s=1234&p=56`;
  const imageUrl = `${options.origin}/share/${user}/og.png?s=1234&p=56`;
  /** 拡張が作る形の共有リンク(スコアを載せない)。 */
  const scorelessShareUrl = `${options.origin}/share/${user}?p=56`;

  console.log(`verify-worker: ${shareUrl}`);

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    let reason;
    try {
      reason = await checkOnce(shareUrl, imageUrl, scorelessShareUrl);
    } catch (error) {
      // 伝播待ちの最中は DNS/TLS/ECONNRESET が単発で起きる。ここで例外を投げると
      // リトライが 1 度も回らずに赤くなる(= デプロイは済んでいるのに人間が呼ばれる)
      reason = `取得に失敗: ${error?.cause?.code ?? error?.cause?.message ?? error?.message ?? error}`;
    }
    if (reason === null) {
      console.log(`✅ /share/* が Worker に届いている(${attempt} 回目で成功)`);
      console.log("   人間 UA → 302 / クローラー UA → 200 + og:image / og.png → image/png");
      console.log("   s なしの共有リンク(拡張)→ スコアを名乗らず、s 付き URL も広告しない");
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

// 引数エラーなどをスタックトレースではなく 1 行で出す(CI のログで読めるように)
await main().catch((error) => {
  console.error(`❌ ${error?.message ?? error}`);
  process.exit(1);
});
