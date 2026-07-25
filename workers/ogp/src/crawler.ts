/**
 * Social/search crawlers are the only clients that ever see the OGP HTML —
 * everyone else gets redirected straight to the app so a shared link opens
 * the game, not a static page. Matched case-insensitively by substring since
 * real crawler User-Agent strings vary in surrounding detail (bot version,
 * "+https://..." suffixes, etc). Generic tokens ("bot", "crawler", ...) catch
 * link-preview fetchers not on the named list; a misclassified human still
 * gets a "play" link in the OGP page body, so a false positive is harmless.
 * LINE must be matched as "line/" (its UA format) — the bare word appears in
 * too many unrelated UA strings.
 */
const CRAWLER_USER_AGENT_SUBSTRINGS = [
  "bot",
  "crawler",
  "spider",
  "preview",
  "externalhit",
  "embedly",
  "whatsapp",
  "line/",
  "pinterest",
  "mastodon",
  "misskey",
  "cardyb",
] as const;

/** True when `userAgent` matches a known social/search crawler, case-insensitively. */
export function isCrawlerUserAgent(userAgent: string | null): boolean {
  if (userAgent === null || userAgent.length === 0) {
    return false;
  }

  const lowerCaseUserAgent = userAgent.toLowerCase();
  return CRAWLER_USER_AGENT_SUBSTRINGS.some((substring) => lowerCaseUserAgent.includes(substring));
}
