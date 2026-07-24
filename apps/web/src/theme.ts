/** Picks core's `LIGHT_THEME` / `DARK_THEME` from the OS colour-scheme preference. */

import type { Theme } from "@kusakuzushi/core";
import { DARK_THEME, LIGHT_THEME } from "@kusakuzushi/core";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function currentTheme(): Theme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? DARK_THEME : LIGHT_THEME;
}

/** Invokes `onChange` with the new theme whenever the OS preference flips. Returns an unsubscribe function. */
export function watchTheme(onChange: (theme: Theme) => void): () => void {
  const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);
  const listener = (): void => onChange(mediaQuery.matches ? DARK_THEME : LIGHT_THEME);
  mediaQuery.addEventListener("change", listener);
  return () => mediaQuery.removeEventListener("change", listener);
}
