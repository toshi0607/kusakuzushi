/**
 * Picks core's `LIGHT_THEME` / `DARK_THEME` from the OS colour-scheme
 * preference. Callers query per frame, so an OS theme flip takes effect
 * without a listener.
 */

import type { Theme } from "@kusakuzushi/core";
import { DARK_THEME, LIGHT_THEME } from "@kusakuzushi/core";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function currentTheme(): Theme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? DARK_THEME : LIGHT_THEME;
}
