/**
 * Top-level view controller: builds the page shell (header / stage /
 * footer) once, swaps the stage between the username form, a loading
 * state, the "no bricks" guard screen, and a play session — and keeps
 * the `?user=` query string in sync.
 *
 * It hands back an `AppController` so something other than the form can
 * start a game and read where it stands (the WebMCP tools in `webmcp/`).
 * Everything goes through the same `startFlow` the form uses, so there is
 * exactly one way into a session.
 */

import type { ContributionGrid, GameState } from "@kusakuzushi/core";

import { UserNotFoundError, fetchGrid, hasBricks } from "./api";
import { createAttract } from "./attract";
import { createSession, type SessionHandle } from "./session";
import { currentTheme } from "./theme";

/** The stage's phases outside a session, followed by the game's own states inside one. */
export type AppPhase = "idle" | "loading" | "empty" | "error" | GameState;

export type AppSnapshot = {
  phase: AppPhase;
  /** The username the stage is showing for, or null on the empty form. */
  user: string | null;
  score: number | null;
  harvestedPercent: number | null;
  lives: number | null;
  bricksLeft: number | null;
  totalContributions: number | null;
};

export type AppController = {
  /** Same path as submitting the form: loads `username`'s grid and starts a session. */
  start(username: string): void;
  getSnapshot(): AppSnapshot;
};

const NO_SESSION = {
  score: null,
  harvestedPercent: null,
  lives: null,
  bricksLeft: null,
  totalContributions: null,
} as const;

function errorMessageFor(error: unknown): string {
  if (error instanceof UserNotFoundError) {
    return `ユーザー ${error.username} が見つかりません`;
  }
  return "取得に失敗しました。時間をおいて再試行してください";
}

function syncUsernameQuery(username: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("user", username);
  window.history.replaceState(null, "", url.toString());
}

/**
 * シェル(見出し / ステージ枠 / フッター)は index.html が持つ。JS で組み立てると
 * First Contentful Paint がバンドルのダウンロードと実行を待つことになり、
 * 実オリジンでだけ FCP/LCP が数秒に伸びる(index.html のコメント参照)。
 * ここはその静的 markup からステージを拾うだけ。
 */
function findStage(root: HTMLElement): HTMLElement {
  const stage = root.querySelector<HTMLElement>("main.stage");
  if (!stage) {
    throw new Error("main.stage not found: index.html のシェルと app.ts が食い違っている");
  }
  return stage;
}

function buildFormView(initialUsername: string, errorMessage: string | undefined, onSubmit: (username: string) => void): { view: HTMLElement; attractHost: HTMLElement } {
  const section = document.createElement("section");
  section.className = "view view-form";

  const attractHost = document.createElement("div");
  attractHost.className = "attract-host";
  section.appendChild(attractHost);

  const form = document.createElement("form");
  form.className = "username-form";

  const input = document.createElement("input");
  input.type = "text";
  input.name = "username";
  input.placeholder = "GitHub ユーザー名";
  input.required = true;
  input.autocomplete = "off";
  input.value = initialUsername;
  form.appendChild(input);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn-primary";
  submit.textContent = "草を刈る";
  form.appendChild(submit);

  section.appendChild(form);

  const hint = document.createElement("p");
  hint.className = "form-hint";
  hint.textContent = "ブロック = あなたの1年分の草";
  section.appendChild(hint);

  if (errorMessage) {
    const error = document.createElement("p");
    error.className = "error-message";
    error.textContent = errorMessage;
    section.appendChild(error);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = input.value.trim();
    if (username) {
      onSubmit(username);
    }
  });

  return { view: section, attractHost };
}

function buildLoadingView(username: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "view view-loading";
  // canvas と同寸(アスペクト比 8:3)の枠を先に置き、
  // デモ → ローディング → プレイでレイアウトが往復しないようにする
  const placeholder = document.createElement("div");
  placeholder.className = "board-placeholder";
  const text = document.createElement("p");
  text.textContent = `${username} の草を取得中…`;
  placeholder.appendChild(text);
  section.appendChild(placeholder);
  return section;
}

function buildEmptyView(onBack: () => void): HTMLElement {
  const section = document.createElement("section");
  section.className = "view view-empty";

  const text = document.createElement("p");
  text.textContent = "崩す草がありません🌵";
  section.appendChild(text);

  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "戻る";
  back.addEventListener("click", onBack);
  section.appendChild(back);

  return section;
}

export function initApp(root: HTMLElement): AppController {
  const stage = findStage(root);
  let session: SessionHandle | null = null;
  let attractCleanup: (() => void) | null = null;
  // What the stage shows when no session is mounted (a mounted session
  // speaks for itself). Every view goes through `swapStage`, so a new view
  // cannot forget to say what it is.
  let stage_: { phase: Exclude<AppPhase, GameState>; user: string | null } = { phase: "idle", user: null };

  function teardownSession(): void {
    session?.destroy();
    session = null;
    attractCleanup?.();
    attractCleanup = null;
  }

  function swapStage(phase: Exclude<AppPhase, GameState>, user: string | null, view: HTMLElement): void {
    teardownSession();
    stage_ = { phase, user };
    stage.replaceChildren(view);
  }

  function showForm(initialUsername: string, errorMessage?: string): void {
    const { view, attractHost } = buildFormView(initialUsername, errorMessage, (username) => {
      void startFlow(username);
    });
    swapStage(errorMessage === undefined ? "idle" : "error", initialUsername || null, view);
    attractCleanup = createAttract(attractHost, currentTheme);
  }

  function showLoading(username: string): void {
    swapStage("loading", username, buildLoadingView(username));
  }

  function showEmpty(username: string): void {
    swapStage("empty", username, buildEmptyView(() => showForm(username)));
  }

  function showSession(username: string, grid: ContributionGrid): void {
    const container = document.createElement("div");
    container.className = "view view-session";

    const status = document.createElement("p");
    status.className = "session-status";
    status.textContent = `@${username} ― ${grid.total.toLocaleString()} contributions`;
    container.appendChild(status);

    // The session's own state is the phase from here on; `stage_` keeps the user.
    swapStage("loading", username, container);
    session = createSession(container, username, grid, currentTheme, {
      onRestart: () => showSession(username, grid),
    });
  }

  async function startFlow(username: string): Promise<void> {
    syncUsernameQuery(username);
    showLoading(username);
    try {
      const grid = await fetchGrid(username);
      if (!hasBricks(grid)) {
        showEmpty(username);
        return;
      }
      showSession(username, grid);
    } catch (error) {
      showForm(username, errorMessageFor(error));
    }
  }

  const initialUsername = new URLSearchParams(window.location.search).get("user");
  if (initialUsername) {
    void startFlow(initialUsername);
  } else {
    showForm("");
  }

  return {
    start(username: string): void {
      void startFlow(username);
    },
    getSnapshot(): AppSnapshot {
      if (session) {
        const { state, score, harvestedPercent, lives, bricksLeft, totalContributions } = session.getSnapshot();
        return { phase: state, user: stage_.user, score, harvestedPercent, lives, bricksLeft, totalContributions };
      }
      return { phase: stage_.phase, user: stage_.user, ...NO_SESSION };
    },
  };
}
