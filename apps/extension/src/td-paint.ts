/**
 * Repaints real grass `td`s to reflect the game's brick state, and
 * restores them exactly as found on teardown. Never touches `data-level` —
 * an inline `style.backgroundColor` wins over GitHub's own CSS class
 * regardless, so there's no need to fight the class-based styling too.
 */

export type TdPainter = {
  paint(el: HTMLElement, level: number): void;
  restoreAll(): void;
};

function clampLevelIndex(level: number): number {
  return Math.min(Math.max(level, 0), 4);
}

/**
 * `levelColors` must be a 5-entry array indexed by contribution level
 * (0-4) — either the real computed colours read via `readLevelColors`, or
 * a bundled theme's `colors` as a fallback.
 */
export function createTdPainter(levelColors: readonly string[]): TdPainter {
  // Records each touched element's original `style` attribute (`null` if
  // it had none) the first time it's painted, so `restoreAll` can put the
  // DOM back exactly as it found it — including removing the attribute
  // entirely for elements that never had one.
  const originalStyles = new Map<HTMLElement, string | null>();

  function paint(el: HTMLElement, level: number): void {
    if (!originalStyles.has(el)) {
      originalStyles.set(el, el.getAttribute("style"));
    }
    el.style.backgroundColor = levelColors[clampLevelIndex(level)];
  }

  function restoreAll(): void {
    for (const [el, style] of originalStyles) {
      if (style === null) {
        el.removeAttribute("style");
      } else {
        el.setAttribute("style", style);
      }
    }
    originalStyles.clear();
  }

  return { paint, restoreAll };
}
