import { describe, expect, it } from "vitest";
import { isCrawlerUserAgent } from "./crawler";

describe("isCrawlerUserAgent", () => {
  it("returns true for Twitterbot", () => {
    // #given / #when / #then
    expect(isCrawlerUserAgent("Twitterbot/1.0")).toBe(true);
  });

  it("returns true for Slackbot", () => {
    expect(isCrawlerUserAgent("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toBe(true);
  });

  it("returns true for facebookexternalhit", () => {
    expect(isCrawlerUserAgent("facebookexternalhit/1.1")).toBe(true);
  });

  it("returns true for Discordbot", () => {
    expect(isCrawlerUserAgent("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)")).toBe(true);
  });

  it("returns true for TelegramBot", () => {
    expect(isCrawlerUserAgent("TelegramBot (like TwitterBot)")).toBe(true);
  });

  it("returns true for WhatsApp", () => {
    expect(isCrawlerUserAgent("WhatsApp/2.23.20.0")).toBe(true);
  });

  it("returns true for Line", () => {
    expect(isCrawlerUserAgent("Line/11.5.0")).toBe(true);
  });

  it("returns true for LinkedInBot", () => {
    expect(isCrawlerUserAgent("LinkedInBot/1.0 (compatible; Mozilla/5.0)")).toBe(true);
  });

  it("returns true for Pinterest", () => {
    expect(isCrawlerUserAgent("Pinterest/0.2 (+https://www.pinterest.com/bot.html)")).toBe(true);
  });

  it("returns true for Googlebot", () => {
    expect(isCrawlerUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(
      true,
    );
  });

  it("returns true for bingbot", () => {
    expect(isCrawlerUserAgent("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toBe(true);
  });

  it("is case-insensitive", () => {
    // #given a crawler substring in mixed/upper case
    // #when / #then
    expect(isCrawlerUserAgent("TWITTERBOT/1.0")).toBe(true);
    expect(isCrawlerUserAgent("GoogleBot")).toBe(true);
  });

  it("returns true for generic link-preview fetchers via the bot/crawler/preview tokens", () => {
    // #given fetchers not on the named list
    // #when / #then
    expect(isCrawlerUserAgent("Mozilla/5.0 (compatible; OpenGraphCrawler/1.0)")).toBe(true);
    expect(isCrawlerUserAgent("SocialSharePreview/1.0")).toBe(true);
    expect(isCrawlerUserAgent("http.rb/5.1.1 (Mastodon/4.2.0; +https://mastodon.social/)")).toBe(true);
    expect(isCrawlerUserAgent("Mozilla/5.0 (compatible; Cardyb/1.1; +https://cardyb.bsky.app)")).toBe(true);
  });

  it("does not match the word 'line' inside an unrelated token", () => {
    // #given a UA containing "line" but not LINE's "Line/" format
    // #when / #then
    expect(isCrawlerUserAgent("Mozilla/5.0 (Linux; Android 14; LineageOS) AppleWebKit/537.36 Chrome/126.0")).toBe(
      false,
    );
  });

  it("returns false for an ordinary browser User-Agent", () => {
    // #given
    const chromeUa =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
    // #when / #then
    expect(isCrawlerUserAgent(chromeUa)).toBe(false);
  });

  it("returns false for a null User-Agent", () => {
    // #given no User-Agent header
    // #when / #then
    expect(isCrawlerUserAgent(null)).toBe(false);
  });

  it("returns false for an empty User-Agent", () => {
    expect(isCrawlerUserAgent("")).toBe(false);
  });
});
