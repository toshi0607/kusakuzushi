/**
 * `autoMount` exists because GitHub streams the contribution graph in via
 * an `<include-fragment>` well after the profile page's initial HTML — a
 * single `mount()` attempt at startup finds no `ContributionCalendar-grid`
 * table and gives up forever. These tests verify the MutationObserver
 * fallback and the full Turbo/bfcache lifecycle it has to track.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AutoMount } from "./content";
import { autoMount } from "./content";

const BUTTON_ID = "kusakuzushi-launch";
const MESSAGE_ID = "kusakuzushi-message";

function buildGrassTable(): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "ContributionCalendar-grid";
  document.body.appendChild(table);
  return table;
}

/**
 * The graph wrapped in the element GitHub's `<include-fragment>` actually
 * replaces — `.js-yearly-contributions` is the fragment response's own root,
 * and it is also where the launch button gets appended.
 */
function buildGraphContainer(): HTMLElement {
  const container = document.createElement("div");
  container.className = "js-yearly-contributions";
  const table = document.createElement("table");
  table.className = "ContributionCalendar-grid";
  container.appendChild(table);
  document.body.appendChild(container);
  return container;
}

/** jsdom's MutationObserver fires its callback as a microtask; flushing a macrotask reliably runs after it. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("autoMount", () => {
  let session: AutoMount | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    session?.stop();
    session = null;
    document.body.innerHTML = "";
  });

  it("injects nothing when the grass table has not streamed in yet", () => {
    // #given an empty profile page (the <include-fragment> hasn't resolved)
    // #when
    session = autoMount(document, window);
    // #then
    expect(document.getElementById(BUTTON_ID)).toBeNull();
  });

  it("injects the button once the grass table is added to the DOM later", async () => {
    // #given autoMount watching an empty document
    session = autoMount(document, window);
    expect(document.getElementById(BUTTON_ID)).toBeNull();
    // #when the fragment resolves and the table streams in
    buildGrassTable();
    await flushMicrotasks();
    // #then the MutationObserver caught it and mounted
    expect(document.getElementById(BUTTON_ID)).not.toBeNull();
  });

  it("does not double-inject when turbo:load fires repeatedly", async () => {
    // #given the grass table already present and mounted
    buildGrassTable();
    session = autoMount(document, window);
    await flushMicrotasks();
    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
    // #when turbo:load fires more than once, as repeated Turbo navigations would
    document.dispatchEvent(new Event("turbo:load"));
    document.dispatchEvent(new Event("turbo:load"));
    // #then still exactly one button
    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
  });

  it("removes the button on turbo:before-cache, since Turbo snapshots the DOM at that point", async () => {
    // #given a mounted button
    buildGrassTable();
    session = autoMount(document, window);
    await flushMicrotasks();
    expect(document.getElementById(BUTTON_ID)).not.toBeNull();
    // #when
    document.dispatchEvent(new Event("turbo:before-cache"));
    // #then cleaned up before the snapshot is taken
    expect(document.getElementById(BUTTON_ID)).toBeNull();
  });

  it("restores the button on pageshow (bfcache restore)", async () => {
    // #given a session torn down by turbo:before-cache, exactly as a bfcache
    // restore would present the page (button already removed by pagehide)
    buildGrassTable();
    session = autoMount(document, window);
    await flushMicrotasks();
    document.dispatchEvent(new Event("turbo:before-cache"));
    expect(document.getElementById(BUTTON_ID)).toBeNull();
    // #when
    window.dispatchEvent(new Event("pageshow"));
    // #then
    expect(document.getElementById(BUTTON_ID)).not.toBeNull();
  });

  it("remounts when the include-fragment replaces the graph container out from under a live mount", async () => {
    // #given a mounted button inside the fragment's own root element
    const container = buildGraphContainer();
    session = autoMount(document, window);
    await flushMicrotasks();
    expect(document.getElementById(BUTTON_ID)).not.toBeNull();

    // #when the fragment re-resolves (year filter, "show private
    // contributions", ...) and swaps the whole container's contents — no
    // Turbo event fires for this
    container.remove();
    buildGraphContainer();
    await flushMicrotasks();

    // #then the observer noticed the button went with it and remounted
    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
  });

  it("remounts even when the replacement DOM carries a copy of the button", async () => {
    // #given a mounted button, then a snapshot-style replacement that
    // duplicates the button element itself — no session is listening to the
    // copy, so an id-based "am I mounted?" check would be fooled by it
    const container = buildGraphContainer();
    session = autoMount(document, window);
    await flushMicrotasks();
    const original = document.getElementById(BUTTON_ID);
    expect(original).not.toBeNull();

    // #when the container is replaced by a deep clone of itself
    const replacement = container.cloneNode(true);
    container.remove();
    document.body.appendChild(replacement);
    await flushMicrotasks();

    // #then the surviving button is a live one, not the inert clone:
    // clicking it reaches a session, which answers the empty grid with its
    // "no grass to break" message
    const buttons = document.querySelectorAll(`#${BUTTON_ID}`);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).not.toBe(original);
    buttons[0].dispatchEvent(new MouseEvent("click"));
    expect(document.getElementById(MESSAGE_ID)).not.toBeNull();
  });

  it("replaces a stale button rather than reusing it, so one click starts one game", async () => {
    // #given a leftover button from a cached snapshot, with its own listener
    buildGraphContainer();
    let staleClicks = 0;
    const stale = document.createElement("button");
    stale.id = BUTTON_ID;
    stale.addEventListener("click", () => {
      staleClicks += 1;
    });
    document.body.appendChild(stale);

    // #when the extension mounts over it and the user clicks once
    session = autoMount(document, window);
    await flushMicrotasks();
    const button = document.getElementById(BUTTON_ID);
    expect(button).not.toBe(stale);
    button?.dispatchEvent(new MouseEvent("click"));

    // #then only the live session reacted — a reused button would still
    // carry the old handler and run two sessions off a single click
    expect(staleClicks).toBe(0);
    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
  });

  it("stop() tears down the listeners: a later turbo:load no longer injects a button", async () => {
    // #given autoMount created (and still watching, since the grass hasn't appeared) then stopped
    session = autoMount(document, window);
    session.stop();
    session = null;
    // #when the grass table appears afterwards and a Turbo navigation fires,
    // as would happen on a real page after the extension tore itself down
    buildGrassTable();
    document.dispatchEvent(new Event("turbo:load"));
    await flushMicrotasks();
    // #then no button — neither the observer nor the turbo:load listener survived stop()
    expect(document.getElementById(BUTTON_ID)).toBeNull();
  });
});
