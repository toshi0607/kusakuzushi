/**
 * Picks core's `LIGHT_THEME` / `DARK_THEME` from the OS colour-scheme
 * preference. Running rAF loops query per frame; loops that stop
 * (result screen, reduced-motion attract) must repaint via `watchTheme`
 * or the canvas keeps the stale theme while the page CSS flips.
 */

import type { Theme } from "@kusakuzushi/core";
import { DARK_THEME, LIGHT_THEME } from "@kusakuzushi/core";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** Web 版の意匠: ボールはマーキーアンバー、HUD はピクセルフォント(DESIGN-VISUAL §1/§5)。 */
const HUD_FONT = '"DotGothic16", "IBM Plex Sans JP", sans-serif';
const ACCENT_COLOR = "#ffb224";

const WEB_LIGHT_THEME: Theme = { ...LIGHT_THEME, accentColor: ACCENT_COLOR, hudFont: HUD_FONT };
/** 共有画像は閲覧者のテーマに関係なく常にこちら(夜の畑)で焼く — share.ts の SHARE_COLORS と同じ判断。 */
export const WEB_DARK_THEME: Theme = { ...DARK_THEME, accentColor: ACCENT_COLOR, hudFont: HUD_FONT };

export function currentTheme(): Theme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? WEB_DARK_THEME : WEB_LIGHT_THEME;
}

/** Invokes `onChange` with the new theme whenever the OS preference flips. Returns an unsubscribe function. */
export function watchTheme(onChange: (theme: Theme) => void): () => void {
  const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);
  const listener = (): void => onChange(mediaQuery.matches ? WEB_DARK_THEME : WEB_LIGHT_THEME);
  mediaQuery.addEventListener("change", listener);
  return () => mediaQuery.removeEventListener("change", listener);
}
