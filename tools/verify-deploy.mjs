/**
 * デプロイ後のスモークチェック。「本番が今配信しているのは、いま出した成果物か」を機械が確定させる。
 *
 * これは過去に人力でやっていた作業の自動化:
 *
 *   - セッション6: デプロイ後に本番が真っ白になり、原因の切り分けに
 *     `curl` + `shasum` で「origin の実体は dist と byte 一致か」を手で確かめた
 *   - セッション12: デプロイ直後の計測が旧ビルドと新ビルドを混ぜて引いた。
 *     判別はアセットのハッシュ名(`index-BpMi0tfA.js` か `index-pr2ZC311.js` か)の目視
 *
 * どちらも「配信中の成果物 == 手元の成果物」が言えれば一発で終わる。
 * エッジへの伝播には数秒〜数十秒かかるので、一致するまでリトライする。
 *
 * 判定は 2 段構え:
 *
 *   1. 本番 HTML が、手元の dist が参照しているのと同じエントリ JS を指しているか
 *      (= 新しい index.html が配信されているか)
 *   2. その JS の実体の sha256 が手元の dist と一致するか
 *      (= ファイル名だけ新しくて中身が別物、切り詰められている、が起きていないか)
 *
 * 2 が要るのは、セッション6 で「切り詰められた JS はパースが通ってしまい、
 * console エラーを出さずに何もしない」という壊れ方を踏んでいるため。
 * 名前の一致だけでは中身を保証できない。
 *
 *   node tools/verify-deploy.mjs [--dist apps/web/dist] [--url https://kusakuzushi.toshi0607.com/]
 *                                [--attempts 10] [--interval 6000]
 *
 * 失敗したら exit 1。デプロイ自体は済んでいるので、これが赤いときは
 * ロールバック(Cloudflare ダッシュボード / `wrangler pages deployment`)を人間が判断する。
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
    options[key] = typeof DEFAULTS[key] === "number" ? Number(value) : value;
  }
  return options;
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * index.html が読み込むエントリ JS のパスを取り出す。
 * Vite は `<script type="module" crossorigin src="/assets/index-XXXX.js"></script>` を出す。
 * CSS は vite.config.ts の inlineStylesheet プラグインで `<style>` に畳まれているので、
 * ハッシュ付きで外部参照されるのはこの JS だけ。
 */
function findEntryScript(html) {
  const match = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/);
  if (!match) {
    throw new Error("index.html にエントリ JS(/assets/*.js)の参照が見つからない");
  }
  return match[1];
}

/** Cloudflare のエッジに残った古いレスポンスを掴まないように、キャッシュを明示的に外す。 */
function fetchFresh(url) {
  return fetch(url, {
    cache: "no-store",
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const siteUrl = new URL(options.url);

  const localHtml = await readFile(join(options.dist, "index.html"), "utf8");
  const entryScript = findEntryScript(localHtml);
  const localAsset = await readFile(join(options.dist, entryScript));
  const localDigest = sha256(localAsset);

  console.log(`verify-deploy: ${siteUrl}`);
  console.log(`  期待するエントリ JS: ${entryScript}`);
  console.log(`  手元の sha256:       ${localDigest}`);

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const reason = await checkOnce(siteUrl, entryScript, localDigest, localAsset.length);
    if (reason === null) {
      console.log(`✅ 本番が手元の成果物を配信している(${attempt} 回目で一致)`);
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

/** 一致したら null、まだなら理由の文字列を返す。 */
async function checkOnce(siteUrl, entryScript, localDigest, localLength) {
  const htmlResponse = await fetchFresh(siteUrl);
  if (!htmlResponse.ok) {
    return `HTML が HTTP ${htmlResponse.status}`;
  }
  const html = await htmlResponse.text();
  if (!html.includes(entryScript)) {
    const served = html.match(/\/assets\/[^"]+\.js/)?.[0] ?? "(参照なし)";
    return `本番 HTML がまだ ${served} を指している`;
  }

  const assetResponse = await fetchFresh(new URL(entryScript, siteUrl));
  if (!assetResponse.ok) {
    return `${entryScript} が HTTP ${assetResponse.status}`;
  }
  const served = Buffer.from(await assetResponse.arrayBuffer());
  const servedDigest = sha256(served);
  if (servedDigest !== localDigest) {
    // 切り詰めは長さで出る。セッション6 の白画面はこの形(1,535 / 21,622 バイト)だった
    return `sha256 不一致(配信 ${servedDigest} / ${served.length}B、手元 ${localLength}B)`;
  }
  return null;
}

await main();
