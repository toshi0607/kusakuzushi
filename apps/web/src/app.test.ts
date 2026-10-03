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
import { createAttract } from "./attract";
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

function mountApp(url: string, rejectFirstFetch = false): MountedApp {
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
  if (rejectFirstFetch) {
    vi.mocked(fetchGrid).mockRejectedValueOnce(new Error("boom"));
  }
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

describe("initApp username form", () => {
  it("ユーザー名欄は英字キーボードで開き、大文字化と自動修正をしない", () => {
    // #given
    const { root } = mountApp("/");

    // #when
    const input = root.querySelector<HTMLInputElement>('input[name="username"]');

    // #then
    expect({
      inputmode: input?.getAttribute("inputmode"),
      autocapitalize: input?.getAttribute("autocapitalize"),
      autocorrect: input?.getAttribute("autocorrect"),
      spellcheck: input?.getAttribute("spellcheck"),
    }).toEqual({ inputmode: "url", autocapitalize: "none", autocorrect: "off", spellcheck: "false" });
  });
});

describe("initApp link-arrival sessions", () => {
  it("共有リンクで着地すると「自分の草を刈る」をトップへの実リンクとして表示する", async () => {
    // #given
    const { root } = mountApp("/?user=octocat");

    // #when
    const view = await waitForSession(root);
    const link = view.querySelector<HTMLAnchorElement>(".session-status > .session-switch");

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

  it("共有リンクで着地するとステータスと切り替えリンクの文字列を空白で区切る", async () => {
    // #given
    const { root } = mountApp("/?user=octocat");

    // #when
    const view = await waitForSession(root);

    // #then
    expect(view.querySelector(".session-status")?.textContent).toBe("@octocat ― 28 contributions 自分の草を刈る");
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

  it("フォームから始めたセッションのステータスは span だけを含む", async () => {
    // #given
    const { root } = mountApp("/");
    const input = root.querySelector<HTMLInputElement>('input[name="username"]');
    const form = root.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("username form fixture not found");
    input.value = "octocat";

    // #when
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    const view = await waitForSession(root);
    const status = view.querySelector(".session-status");
    if (!status) throw new Error("session status not found");

    // #then
    expect(Array.from(status.childNodes).map((n) => n.nodeName)).toEqual(["SPAN"]);
  });

  it("フォームから始めたセッションは再開後も切り替えリンクを表示しない", async () => {
    // #given
    const { root, sessions } = mountApp("/");
    const input = root.querySelector<HTMLInputElement>('input[name="username"]');
    const form = root.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("username form fixture not found");
    input.value = "octocat";
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    const view = await waitForSession(root);

    // #when
    sessions[0]?.handlers.onRestart();
    const restartedView = root.querySelector(".view-session");

    // #then
    expect({ rebuilt: restartedView !== view, link: restartedView?.querySelector(".session-switch") }).toEqual({ rebuilt: true, link: null });
  });

  it("共有リンクから始めたセッションは再開後も切り替えリンクを表示する", async () => {
    // #given
    const { root, sessions } = mountApp("/?user=octocat");
    const view = await waitForSession(root);

    // #when
    sessions[0]?.handlers.onRestart();
    const restartedView = root.querySelector(".view-session");

    // #then
    expect({ rebuilt: restartedView !== view, hasLink: restartedView?.querySelector(".session-switch") != null }).toEqual({ rebuilt: true, hasLink: true });
  });

  it("共有ユーザーからフォームへ切り替えると自分のセッションと URL に更新する", async () => {
    // #given
    const { root, sessions } = mountApp("/?user=octocat");
    const view = await waitForSession(root);
    const link = view.querySelector(".session-switch");
    if (!link) throw new Error("session switch link not found");

    // #when
    plainClick(link);
    const input = root.querySelector<HTMLInputElement>('input[name="username"]');
    const form = root.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("username form fixture not found");
    input.value = "monalisa";
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    const ownView = await waitForSession(root);

    // #then
    expect({ username: sessions[1]?.username, link: ownView.querySelector(".session-switch"), search: window.location.search }).toEqual({ username: "monalisa", link: null, search: "?user=monalisa" });
  });

  it("共有リンクの取得に失敗して同じ名前で再試行すると切り替えリンクを表示する", async () => {
    // #given
    const { root } = mountApp("/?user=octocat", true);
    await vi.waitFor(() => {
      expect(root.querySelector(".error-message")).not.toBeNull();
    });
    const form = root.querySelector<HTMLFormElement>("form");
    if (!form) throw new Error("username form fixture not found");

    // #when
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    const view = await waitForSession(root);

    // #then
    expect(view.querySelector(".session-status > .session-switch")).not.toBeNull();
  });

  it("共有リンクの取得に失敗して別の名前を送信すると切り替えリンクを表示しない", async () => {
    // #given
    const { root } = mountApp("/?user=octocat", true);
    await vi.waitFor(() => {
      expect(root.querySelector(".error-message")).not.toBeNull();
    });
    const input = root.querySelector<HTMLInputElement>('input[name="username"]');
    const form = root.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("username form fixture not found");
    input.value = "monalisa";

    // #when
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    const view = await waitForSession(root);

    // #then
    expect(view.querySelector(".session-switch")).toBeNull();
  });

  it("フォームの取得に失敗して同じ名前で再試行しても切り替えリンクを表示しない", async () => {
    // #given
    const { root } = mountApp("/", true);
    const input = root.querySelector<HTMLInputElement>('input[name="username"]');
    const form = root.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("username form fixture not found");
    input.value = "octocat";
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".error-message")).not.toBeNull();
    });
    const retryForm = root.querySelector<HTMLFormElement>("form");
    if (!retryForm) throw new Error("username form fixture not found");

    // #when
    retryForm.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    const view = await waitForSession(root);

    // #then
    expect(view.querySelector(".session-switch")).toBeNull();
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

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)("%s 付きクリックはブラウザーに任せてセッションを残す", async (modifier) => {
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
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, [modifier]: true }));

    // #then
    expect({ defaultPrevented, session: root.querySelector(".view-session") }).toEqual({ defaultPrevented: false, session: view });
  });

  it("フォームへの切り替えが失敗すると URL の user パラメーターを残す", async () => {
    // #given
    const { root } = mountApp("/?user=octocat");
    const view = await waitForSession(root);
    const link = view.querySelector(".session-switch");
    if (!link) throw new Error("session switch link not found");
    vi.mocked(createAttract).mockImplementationOnce(() => {
      throw new Error("attract failed");
    });
    // DOM dispatch reports listener exceptions through window.error instead of throwing.
    window.addEventListener("error", (event) => {
      if (event.error instanceof Error && event.error.message === "attract failed") {
        event.preventDefault();
      }
    }, { once: true });

    // #when
    plainClick(link);

    // #then
    expect(window.location.search).toBe("?user=octocat");
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
