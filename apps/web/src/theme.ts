/**
 * Picks core's `LIGHT_THEME` / `DARK_THEME` from the OS colour-scheme
 * preference. Callers query per frame, so an OS theme flip takes effect
 * without a listener.
 */

import type { Theme } from "@kusakuzushi/core";
import { DARK_THEME, LIGHT_THEME } from "@kusakuzushi/core";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** Web 版の意匠: ボールはマーキーアンバー、HUD はピクセルフォント(DESIGN-VISUAL §1/§5)。 */
const HUD_FONT = '"DotGothic16", "IBM Plex Sans JP", sans-serif';
const ACCENT_COLOR = "#ffb224";

const WEB_LIGHT_THEME: Theme = { ...LIGHT_THEME, accentColor: ACCENT_COLOR, hudFont: HUD_FONT };
const WEB_DARK_THEME: Theme = { ...DARK_THEME, accentColor: ACCENT_COLOR, hudFont: HUD_FONT };

export function currentTheme(): Theme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? WEB_DARK_THEME : WEB_LIGHT_THEME;
}
