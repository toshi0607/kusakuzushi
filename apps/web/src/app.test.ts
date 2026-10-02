/**
 * @vitest-environment jsdom
 *
 * Covers the decisions only `initApp` makes: which sessions carry the link
 * and what pressing it does. The session and attract demo are stubbed because
 * they need a canvas and frame loop that are outside this file's concern.
 */

import type { ContributionGrid } from "@kusakuzushi/core";
import { toGrid } from "@kusakuzushi/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchGrid } from "./api";
import { initApp, type AppController } from "./app";
import { createSession, type SessionHandle, type SessionHandlers, type SessionSnapshot } from "./session";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, fetchGrid: vi.fn() };
});

vi.mock("./attract", () => ({ createAttract: vi.fn(() => () => {}) }));
vi.mock("./session", () => ({ createSession: vi.fn() }));

const SESSION_SNAPSHOT: SessionSnapshot = {
  state: "ready",
  score: 0,
  harvestedPercent: 0,
  lives: 3,
  bricksLeft: 28,
  totalContributions: 28,
};

type StubbedSession = {
  handle: SessionHandle;
  handlers: SessionHandlers;
  username: string;
};

type MountedApp = {
  controller: AppController;
  root: HTMLElement;
  sessions: StubbedSession[];
};

function grassGrid(username = "octocat"): ContributionGrid {
  const cells = Array.from({ length: 28 }, (_, index) => ({
    date: `2024-01-${String(index + 1).padStart(2, "0")}`,
    count: 1,
    level: 1 as const,
  }));
  return toGrid(username, cells);
}

function mountApp(url: string): MountedApp {
  window.history.replaceState(null, "", url);
  document.body.innerHTML = `
    <div id="app">
      <header class="site-header"><h1><a href="/">草崩し</a></h1></header>
      <main class="stage"></main>
    </div>
  `;
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) throw new Error("#app fixture not found");

  const sessions: StubbedSession[] = [];
  vi.mocked(fetchGrid).mockResolvedValue(grassGrid());
  vi.mocked(createSession).mockImplementation((_container, username, _grid, _getTheme, handlers) => {
    const handle: SessionHandle = {
      destroy: vi.fn(),
      getSnapshot: () => SESSION_SNAPSHOT,
    };
    sessions.push({ handle, handlers, username });
    return handle;
  });

  return { controller: initApp(root), root, sessions };
}

async function waitForSession(root: HTMLElement): Promise<HTMLElement> {
  await vi.waitFor(() => {
    expect(root.querySelector(".session-status")).not.toBeNull();
  });
  const view = root.querySelector<HTMLElement>(".view-session");
  if (!view) throw new Error("session view not found");
  return view;
}

function plainClick(target: Element): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
});

describe("initApp link-arrival sessions", () => {
  it("共有リンクで着地すると「自分の草を刈る」をトップへの実リンクとして表示する", async () => {
    // #given
    const { root } = mountApp("/?user=octocat");

    // #when
    const view = await waitForSession(root);
    const link = view.querySelector<HTMLAnchorElement>(".session-switch");

    // #then
    expect({ text: link?.textContent, href: link?.getAttribute("href") }).toEqual({ text: "自分の草を刈る", href: "/" });
  });

  it("共有リンクで着地すると共有ユーザーのセッションをすぐ始める", async () => {
    // #given
    const { root, sessions } = mountApp("/?user=octocat");

    // #when
    await waitForSession(root);

    // #then
    expect(sessions[0]?.username).toBe("octocat");
  });

  it("フォームから始めたセッションには切り替えリンクを表示しない", async () => {
    // #given
    const { root } = mountApp("/");
    const input = root.querySelector<HTMLInputElement>('input[name="username"]');
    const form = root.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("username form fixture not found");
    input.value = "octocat";

    // #when
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    const view = await waitForSession(root);

    // #then
    expect(view.querySelector(".session-switch")).toBeNull();
  });

  it("コントローラーから始めたセッションには切り替えリンクを表示しない", async () => {
    // #given
    const { controller, root } = mountApp("/");

    // #when
    controller.start("octocat");
    const view = await waitForSession(root);

    // #then
    expect(view.querySelector(".session-switch")).toBeNull();
  });

  it("共有リンクから始めたセッションは再開後も切り替えリンクを表示する", async () => {
    // #given
    const { root, sessions } = mountApp("/?user=octocat");
    await waitForSession(root);

    // #when
    sessions[0]?.handlers.onRestart();

    // #then
    expect(root.querySelector(".session-switch")).not.toBeNull();
  });

  it("切り替えリンクを押すと空のユーザー名フォームへ差し替える", async () => {
    // #given
    const { root } = mountApp("/?user=octocat");
    const view = await waitForSession(root);
    const link = view.querySelector(".session-switch");
    if (!link) throw new Error("session switch link not found");

    // #when
    plainClick(link);

    // #then
    expect({ value: root.querySelector<HTMLInputElement>('input[name="username"]')?.value, session: root.querySelector(".view-session") }).toEqual({ value: "", session: null });
  });

  it("切り替えリンクを押すと URL から user パラメーターを外す", async () => {
    // #given
    const { root } = mountApp("/?user=octocat");
    const view = await waitForSession(root);
    const link = view.querySelector(".session-switch");
    if (!link) throw new Error("session switch link not found");

    // #when
    plainClick(link);

    // #then
    expect(window.location.search).toBe("");
  });

  it("切り替えリンクを押しても user 以外のクエリは残す", async () => {
    // #given
    const { root } = mountApp("/?user=octocat&ref=x");
    const view = await waitForSession(root);
    const link = view.querySelector(".session-switch");
    if (!link) throw new Error("session switch link not found");

    // #when
    plainClick(link);

    // #then
    expect(window.location.search).toBe("?ref=x");
  });

  it("切り替えリンクを押すとユーザー名入力へフォーカスを移す", async () => {
    // #given
    const { root } = mountApp("/?user=octocat");
    const view = await waitForSession(root);
    const link = view.querySelector(".session-switch");
    if (!link) throw new Error("session switch link not found");

    // #when
    plainClick(link);

    // #then
    expect(document.activeElement).toBe(root.querySelector('input[name="username"]'));
  });

  it("切り替えリンクを押すと実行中のセッションを破棄する", async () => {
    // #given
    const { root, sessions } = mountApp("/?user=octocat");
    const view = await waitForSession(root);
    const link = view.querySelector(".session-switch");
    if (!link) throw new Error("session switch link not found");

    // #when
    plainClick(link);

    // #then
    expect(sessions[0]?.handle.destroy).toHaveBeenCalledOnce();
  });

  it("修飾キー付きクリックはブラウザーに任せてセッションを残す", async () => {
    // #given
    const { root } = mountApp("/?user=octocat");
    const view = await waitForSession(root);
    const link = view.querySelector(".session-switch");
    if (!link) throw new Error("session switch link not found");
    let defaultPrevented: boolean | undefined;
    document.addEventListener("click", (event) => {
      defaultPrevented = event.defaultPrevented;
      event.preventDefault();
    }, { once: true });

    // #when
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true }));

    // #then
    expect({ defaultPrevented, session: root.querySelector(".view-session") }).toEqual({ defaultPrevented: false, session: view });
  });

  it("切り替えリンクを押した後のスナップショットは空のフォームを示す", async () => {
    // #given
    const { controller, root } = mountApp("/?user=octocat");
    const view = await waitForSession(root);
    const link = view.querySelector(".session-switch");
    if (!link) throw new Error("session switch link not found");

    // #when
    plainClick(link);

    // #then
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", user: null });
  });
});
