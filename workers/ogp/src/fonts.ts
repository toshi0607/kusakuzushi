/**
 * Loads (and caches) the Noto Sans JP weights satori needs to render the OGP
 * image. This is a fixed re-implementation of `workers-og`'s `loadGoogleFont`:
 * that helper interpolates `text` into the css2 URL without percent-encoding,
 * and the raw `%` in our subset becomes an invalid percent-escape that makes
 * Google silently drop the Japanese glyphs from the returned font (verified
 * 2026-07-25 by diffing the two subsets' cmaps).
 *
 * Fonts are subset via the `text` param to keep the fetched TTF small, but the
 * subset must be independent of any single request's username so the module-
 * scope cache below can serve every request without re-fetching: it covers
 * the fixed Japanese phrase plus every character a GitHub username or the
 * score/percentage/domain text could ever contain.
 */

const FONT_FAMILY = "Noto Sans JP";

const FONT_TEXT =
  "の草を刈り取ったスコア草崩" +
  "kusakuzushi.toshi0607.com" +
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" +
  "%,.- ";

// Google's css2 endpoint serves WOFF2 (which satori cannot parse) to modern
// browsers; this old-Safari User-Agent makes it fall back to a TTF URL.
const TTF_USER_AGENT =
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";

export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: number;
  style: "normal";
};

async function loadSubsetFont(weight: number): Promise<ArrayBuffer> {
  const cssUrl =
    `https://fonts.googleapis.com/css2` +
    `?family=${encodeURIComponent(FONT_FAMILY)}:wght@${weight}` +
    `&text=${encodeURIComponent(FONT_TEXT)}`;

  const cssResponse = await fetch(cssUrl, { headers: { "user-agent": TTF_USER_AGENT } });
  if (!cssResponse.ok) {
    throw new Error(`Google Fonts css2 request failed: ${cssResponse.status}`);
  }

  const css = await cssResponse.text();
  const fontUrl = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
  if (!fontUrl) {
    throw new Error("No TTF/OTF font URL in the css2 response");
  }

  const fontResponse = await fetch(fontUrl);
  if (!fontResponse.ok) {
    throw new Error(`Font download failed: ${fontResponse.status}`);
  }
  return fontResponse.arrayBuffer();
}

// Workers reuse the isolate across requests within its lifetime; re-fetching
// and re-subsetting Google Fonts on every request would blow the CPU budget
// (Workers' free-plan CPU limit is ~10ms per request), so this is fetched
// once per isolate and reused thereafter.
let cachedFonts: OgFont[] | null = null;

/** Loads (and caches) the two Noto Sans JP weights (700, 400) used by the OGP image. */
export async function loadOgFonts(): Promise<OgFont[]> {
  if (cachedFonts) {
    return cachedFonts;
  }

  const [bold, regular] = await Promise.all([loadSubsetFont(700), loadSubsetFont(400)]);

  cachedFonts = [
    { name: FONT_FAMILY, data: bold, weight: 700, style: "normal" },
    { name: FONT_FAMILY, data: regular, weight: 400, style: "normal" },
  ];
  return cachedFonts;
}
