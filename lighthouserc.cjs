/**
 * Lighthouse CI の設定。計測対象は apps/web(公開ページ)のみ。
 * 拡張版はページ所有者が GitHub なので計測しない。
 *
 * 3 つのターゲットを 1 ファイルで切り替える(KUSAKUZUSHI_LH_TARGET):
 *
 *   pnpm lh        → dist       (apps/web/dist を lhci のローカル静的サーバで配信)
 *   pnpm lh:slow   → slow       (同じ dist を TTFB 170ms のサーバで配信)
 *   pnpm lh:prod   → production (本番 URL をそのまま計測)
 *
 * なぜ 3 つ要るか(セッション12):
 *
 *   dist は localhost 配信なので RTT ≒ 0 / server-response-time ≒ 20ms になる。
 *   その条件では **クリティカルパスの往復が何回あっても FCP はほとんど動かない**。
 *   実際「First Paint が module JS の実行を待っている」という劣化が dist では
 *   100 点のまま通り抜け、本番でだけ FCP 4.1s(しきい値 1.8s)として出た。
 *   dist は「差分がバンドルサイズや監査項目を壊していないか」しか見られない。
 *
 *   slow はその穴を埋める PR ゲート。dist と同じ成果物を、本番実測の TTFB
 *   (server-response-time 170ms、2026-07-25)を挟むサーバから配信するので、
 *   往復が 1 回増えれば FCP に跳ね返る。外部要因(回線・Pages の機嫌)は入らないので
 *   production と違って決定的に使える。
 *
 *   production はデプロイ済みの実物の健康診断。ネットワークとエッジの実状が入るぶん
 *   ばらつくが、キャッシュヘッダなど本番でしか見られない監査がある。
 */

const PRODUCTION_URL = "https://kusakuzushi.toshi0607.com/";

/** slow ターゲットの TTFB。本番の server-response-time 実測値(2026-07-25)。 */
const SLOW_TTFB_MS = 170;
const SLOW_PORT = 4173;

// 環境変数名を LHCI_ で始めてはいけない。lhci は LHCI_* を自分の CLI 引数として
// 読むため、LHCI_TARGET=production は upload の --target production になり
// 「Invalid values: target」で落ちる(実測で踏んだ)。
const target = process.env.KUSAKUZUSHI_LH_TARGET ?? "dist";

/**
 * 全ターゲット共通の土台。
 *
 * FCP 1800ms / LCP 2500ms は Core Web Vitals の "good" 境界(モバイル)そのもので、
 * どこかの実測から逆算した値ではない。**だからターゲットごとに緩めない** —
 * 緩めた瞬間に「その環境では何 ms でも良い」という意味になり、退行が見えなくなる。
 *
 * 個別監査は「ここに書いたものだけ」を見る(preset を使わない)。
 * preset は lhci のローカル静的サーバに cache ヘッダが無いことなど、
 * 本番と無関係な理由で赤くなるため。カテゴリスコアで全体は担保する。
 */
const assertions = {
  "categories:performance": ["error", { minScore: 0.9 }],
  "categories:accessibility": ["error", { minScore: 1 }],
  "categories:best-practices": ["error", { minScore: 1 }],
  "categories:seo": ["error", { minScore: 1 }],

  "first-contentful-paint": ["error", { maxNumericValue: 1800 }],
  "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
  "total-blocking-time": ["error", { maxNumericValue: 200 }],
  "cumulative-layout-shift": ["error", { maxNumericValue: 0.05 }],

  /*
   * セッション8 の回帰ガード。Google Fonts の CSS を素の <link rel="stylesheet"> に
   * 戻すと 2 件増えて落ちる(それで FCP/LCP が 3.0s に戻る)。
   * セッション12 で自前 CSS をインライン化したので、いまは 0 件が正。
   */
  "render-blocking-resources": ["error", { maxLength: 0 }],

  // JS が肥大化していないか。実測 9KB(転送量)に対する上限。
  "resource-summary:script:size": ["error", { maxNumericValue: 40000 }],
  // 日本語 web フォントのサブセット数で変動するので warn 止まり。実測 185KB。
  "resource-summary:total:size": ["warn", { maxNumericValue: 300000 }],
};

if (target === "production") {
  // Cloudflare Pages のキャッシュヘッダは本番でしか評価できない
  assertions["uses-long-cache-ttl"] = ["warn", {}];
}

/*
 * numberOfRuns は 5(セッション16)。3 だと CI がだいたい落ちる:
 * GitHub のランナーは起動直後の 1〜2 run で「Unattributable」な長タスク
 * (実測 2044ms / 509ms、ページの JS ではなくランナー側の負荷)が main thread に
 * 割り込み、TBT が [564, 1913, 0] / [601, 1171, 23] のように前半だけ跳ねる。
 * median 判定でも 3 run 中 2 run 汚染だと中央値が汚染側になる。
 * 5 run なら前半 2 run が汚れても中央値はクリーン側に落ちる
 * (上の実測に 5 run を当てると中央値 0 / 23 で全部通る)。
 * 3 run 目以降が汚れた例は観測していない(2026-07-26/27 の attempt 1 ログ)。
 */
const NUMBER_OF_RUNS = 5;

const collectByTarget = {
  dist: { staticDistDir: "apps/web/dist", numberOfRuns: NUMBER_OF_RUNS },
  slow: {
    startServerCommand: `node tools/lh-slow-server.mjs apps/web/dist ${SLOW_TTFB_MS} ${SLOW_PORT}`,
    startServerReadyPattern: "lh-slow-server",
    url: [`http://localhost:${SLOW_PORT}/`],
    numberOfRuns: NUMBER_OF_RUNS,
  },
  production: { url: [PRODUCTION_URL], numberOfRuns: NUMBER_OF_RUNS },
};

const collect = collectByTarget[target];
if (!collect) {
  throw new Error(
    `unknown KUSAKUZUSHI_LH_TARGET: ${target} (expected one of ${Object.keys(collectByTarget).join(", ")})`,
  );
}

module.exports = {
  ci: {
    collect,
    assert: {
      // 3 回の中央値で判定する(既定の optimistic は最良回だけを見るので回帰を見逃す)
      aggregationMethod: "median",
      assertions,
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci/report",
      reportFilenamePattern: "%%PATHNAME%%-%%DATETIME%%.report.%%EXTENSION%%",
    },
  },
};
