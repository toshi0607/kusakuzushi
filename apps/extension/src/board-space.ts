/**
 * Reserves the page space the overlay's lower half needs, and gives it back
 * on teardown.
 *
 * The board is twice the grass's height: the top half sits on the real
 * `td`s, the bottom half is where the ball, the paddle and the HUD live.
 * But the overlay is an absolutely-positioned canvas (see overlay.ts), so
 * the page below the calendar never learns it is there — everything in that
 * lower half gets drawn straight over GitHub's own legend and the
 * organisation chips.
 *
 * Pushes whatever follows the calendar down by exactly the overhang, and
 * restores the anchor's original inline style on release — including
 * removing the attribute when there wasn't one — the same all-or-nothing
 * discipline td-paint.ts uses for the cells it repaints.
 */

export type BoardSpace = {
  /** Puts the page back exactly as it was found. Safe to call twice. */
  release(): void;
};

export function reserveBoardSpace(anchor: HTMLElement, canvas: HTMLElement, view: Window): BoardSpace {
  const original = anchor.getAttribute("style");

  function release(): void {
    if (original === null) {
      anchor.removeAttribute("style");
      return;
    }
    anchor.setAttribute("style", original);
  }

  const overhang = canvas.getBoundingClientRect().bottom - anchor.getBoundingClientRect().bottom;
  // A board that already fits (or a host without layout, like jsdom) needs
  // nothing reserved — but still hand back a `release` so the caller's
  // teardown path stays unconditional.
  if (!(overhang > 0)) return { release };

  const existing =
    typeof view.getComputedStyle === "function"
      ? Number.parseFloat(view.getComputedStyle(anchor).marginBottom) || 0
      : 0;
  anchor.style.marginBottom = `${existing + Math.ceil(overhang)}px`;

  return { release };
}
