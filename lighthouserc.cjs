/**
 * Lighthouse CI の設定。計測対象は apps/web(公開ページ)のみ。
 * 拡張版はページ所有者が GitHub なので計測しない。
 *
 * 2 つのターゲットを 1 ファイルで切り替える:
 *
 *   pnpm lh        → dist(apps/web/dist をローカル静的サーバで配信して計測)
 *   pnpm lh:prod   → production(本番 URL をそのまま計測)
 *
 * dist は「PR の差分がスコアを落としていないか」を決定的に見るため、
 * production は「デプロイ済みの実物が劣化していないか」を定期的に見るため。
 * 同じしきい値を共有し、環境に固有の監査だけを足し引きする。
 */

const PRODUCTION_URL = "https://kusakuzushi.toshi0607.com/";

// 環境変数名を LHCI_ で始めてはいけない。lhci は LHCI_* を自分の CLI 引数として
// 読むため、LHCI_TARGET=production は upload の --target production になり
// 「Invalid values: target」で落ちる(実測で踏んだ)。
const isProduction = process.env.KUSAKUZUSHI_LH_TARGET === "production";

/**
 * しきい値は 2026-07-25 の実測(dist / mobile / 3 runs)を基準に、
 * CI マシンのばらつき分の余裕を持たせた値。実測は
 * performance 100 / FCP 0.9s / LCP 0.9s / TBT 0ms / CLS 0.005。
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
   * 許容 1 件は自前の /assets/*.css(同一オリジン・約 2KB)。
   */
  "render-blocking-resources": ["error", { maxLength: 1 }],

  // JS が肥大化していないか。実測 9KB(転送量)に対する上限。
  "resource-summary:script:size": ["error", { maxNumericValue: 40000 }],
  // 日本語 web フォントのサブセット数で変動するので warn 止まり。実測 185KB。
  "resource-summary:total:size": ["warn", { maxNumericValue: 300000 }],
};

if (isProduction) {
  // Cloudflare Pages のキャッシュヘッダは本番でしか評価できない
  assertions["uses-long-cache-ttl"] = ["warn", {}];
}

module.exports = {
  ci: {
    collect: isProduction
      ? { url: [PRODUCTION_URL], numberOfRuns: 3 }
      : { staticDistDir: "apps/web/dist", numberOfRuns: 3 },
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
