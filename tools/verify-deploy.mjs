/**
 * デプロイ後のスモークチェック。「本番が今配信しているのは、いま出した成果物か」を機械が確定させる。
 *
 * これは過去に人力でやっていた作業の自動化:
 *
 *   - セッション6: デプロイ後に本番が真っ白。切り分けで「origin の実体は dist と byte 一致か」を
 *     `curl` + `shasum` で手作業確認した
 *   - セッション12: デプロイ直後の計測が旧ビルドと新ビルドを混ぜて引いた。
 *     判別はアセットのハッシュ名(`index-BpMi0tfA.js` か `index-pr2ZC311.js` か)の目視
 *   - セッション9: `/robots.txt` が index.html になっていて Lighthouse SEO が 92 に落ちた。
 *     Pages は存在しないパスに index.html を **200** で返すので、200 は「在る」の証明にならない
 *
 * どれも「配信中の成果物 == 手元の成果物」が言えれば一発で終わる。
 * エッジへの伝播には数秒〜数十秒かかるので、一致するまでリトライする。
 *
 * 判定は 2 段構え:
 *
 *   1. `/` が、手元の dist が参照しているのと同じエントリ JS を指しているか
 *      (= 新しい index.html が配信されているか)
 *   2. **dist の全ファイル**の sha256 が本番と一致するか
 *      (= 名前だけ新しくて中身が別物、切り詰められている、そもそも配信されていない、が無いか)
 *
 * 2 が要るのは、セッション6 で「切り詰められた JS はパースが通ってしまい、console エラーを
 * 出さずに何もしない」という壊れ方を、セッション9 で「200 が返るのに中身が index.html」という
 * 壊れ方を踏んでいるため。**ステータスコードも名前の一致も、中身を保証しない。**
 * dist は 10 ファイル未満なので全部見ても 1 往復ぶんの手間しかかからない。
 *
 *   node tools/verify-deploy.mjs [--dist apps/web/dist] [--url https://kusakuzushi.toshi0607.com/]
 *                                [--attempts 10] [--interval 6000]
 *
 * 失敗したら exit 1。デプロイ自体は済んでいるので、これが赤いときは
 * ロールバック(Cloudflare ダッシュボード / `wrangler pages deployment`)を人間が判断する。
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

const DEFAULTS = {
  dist: "apps/web/dist",
  url: "https://kusakuzushi.toshi0607.com/",
  attempts: 10,
  interval: 6000,
};

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

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** dist 配下の全ファイルを、URL パス(`/assets/index-XXXX.js` 形式)で返す。 */
async function listDistFiles(dist) {
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `/${relative(dist, join(entry.parentPath, entry.name)).split(sep).join(posix.sep)}`)
    .sort();
}

/**
 * index.html が読み込むエントリ JS を全部取り出す。
 * Vite は `<script type="module" crossorigin src="/assets/index-XXXX.js"></script>` を出す。
 * CSS は vite.config.ts の inlineStylesheet プラグインで `<style>` に畳まれているので、
 * ハッシュ付きで外部参照されるのは今のところこの JS だけ。将来チャンクが分かれても
 * 全部を突き合わせるように、最初の 1 個ではなく全件を見る。
 */
function findEntryScripts(html) {
  const scripts = [...html.matchAll(/<script[^>]+src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  if (scripts.length === 0) {
    throw new Error("index.html にエントリ JS(/assets/*.js)の参照が見つからない");
  }
  return scripts;
}

/** Cloudflare のエッジに残った古いレスポンスを掴まないように、キャッシュを明示的に外す。 */
function fetchFresh(url) {
  return fetch(url, {
    cache: "no-store",
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
  });
}

/** 一致したら null、まだなら理由の文字列を返す。ネットワーク例外も理由として扱う(後述)。 */
async function checkOnce(siteUrl, entryScripts, localDigests) {
  const htmlResponse = await fetchFresh(siteUrl);
  if (!htmlResponse.ok) {
    return `HTML が HTTP ${htmlResponse.status}`;
  }
  const html = await htmlResponse.text();
  const missing = entryScripts.filter((script) => !html.includes(script));
  if (missing.length > 0) {
    const served = html.match(/\/assets\/[^"]+\.js/)?.[0] ?? "(参照なし)";
    return `本番 HTML がまだ ${served} を指している(期待: ${missing.join(", ")})`;
  }

  for (const [path, expected] of localDigests) {
    // index.html は `/` として配信されるものを見る(人が実際に踏む経路)
    const target = new URL(path === "/index.html" ? "." : path.slice(1), siteUrl);
    const response = await fetchFresh(target);
    if (!response.ok) {
      return `${path} が HTTP ${response.status}`;
    }
    const served = Buffer.from(await response.arrayBuffer());
    const digest = sha256(served);
    if (digest !== expected.digest) {
      // 切り詰めは長さで出る。セッション6 の白画面はこの形(1,535 / 21,622 バイト)だった。
      // 長さが index.html と同じなら、セッション9 の「200 で index.html が返る」形
      return `${path} の sha256 不一致(配信 ${served.length}B / ${digest.slice(0, 12)}…、手元 ${expected.size}B / ${expected.digest.slice(0, 12)}…)`;
    }
  }

  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const siteUrl = new URL(options.url);

  const paths = await listDistFiles(options.dist);
  const localDigests = new Map();
  for (const path of paths) {
    const body = await readFile(join(options.dist, path.slice(1)));
    localDigests.set(path, { digest: sha256(body), size: body.length });
  }

  const localHtml = await readFile(join(options.dist, "index.html"), "utf8");
  const entryScripts = findEntryScripts(localHtml);

  console.log(`verify-deploy: ${siteUrl}`);
  console.log(`  期待するエントリ JS: ${entryScripts.join(", ")}`);
  console.log(`  照合するファイル:    ${paths.length} 件`);

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    let reason;
    try {
      reason = await checkOnce(siteUrl, entryScripts, localDigests);
    } catch (error) {
      // 伝播待ちの最中は DNS/TLS/ECONNRESET が単発で起きる。ここで例外を投げると
      // リトライが 1 度も回らずに赤くなる(= デプロイは済んでいるのに人間が呼ばれる)
      reason = `取得に失敗: ${error?.cause?.code ?? error?.cause?.message ?? error?.message ?? error}`;
    }
    if (reason === null) {
      console.log(`✅ 本番が手元の成果物を配信している(${attempt} 回目で一致、${paths.length} 件すべて sha256 一致)`);
      return;
    }
    console.log(`  [${attempt}/${options.attempts}] ${reason}`);
    if (attempt < options.attempts) {
      await sleep(options.interval);
    }
  }

  console.error(
    `❌ ${options.attempts} 回試して一致しなかった。` +
      "デプロイは済んでいるので、伝播待ちか、別の成果物が配信されている。",
  );
  process.exit(1);
}

// 引数エラーなどをスタックトレースではなく 1 行で出す(CI のログで読めるように)
await main().catch((error) => {
  console.error(`❌ ${error?.message ?? error}`);
  process.exit(1);
});
