/**
 * Top-level view controller: swaps between the username form, a loading
 * state, the "no bricks" guard screen, and a play session — and keeps the
 * `?user=` query string and the page background theme in sync.
 */

import type { ContributionGrid } from "@kusakuzushi/core";

import { UserNotFoundError, fetchGrid, hasBricks } from "./api";
import { createSession } from "./session";
import { currentTheme, watchTheme } from "./theme";

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

function applyPageTheme(): void {
  const theme = currentTheme();
  document.body.style.backgroundColor = theme.colors[0];
  document.body.style.color = theme.textColor;
}

function buildFormView(initialUsername: string, errorMessage: string | undefined, onSubmit: (username: string) => void): HTMLElement {
  const section = document.createElement("section");
  section.className = "view view-form";

  const title = document.createElement("h1");
  title.textContent = "草崩し";
  section.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = "GitHub の草をブロックに見立てて刈り取るブロック崩しゲーム";
  section.appendChild(subtitle);

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
  submit.textContent = "はじめる";
  form.appendChild(submit);

  section.appendChild(form);

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

  return section;
}

function buildLoadingView(username: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "view view-loading";
  const text = document.createElement("p");
  text.textContent = `${username} の草を取得中...`;
  section.appendChild(text);
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

export function initApp(root: HTMLElement): void {
  let sessionCleanup: (() => void) | null = null;

  function teardownSession(): void {
    sessionCleanup?.();
    sessionCleanup = null;
  }

  function showForm(initialUsername: string, errorMessage?: string): void {
    teardownSession();
    root.replaceChildren(
      buildFormView(initialUsername, errorMessage, (username) => {
        void startFlow(username);
      }),
    );
  }

  function showLoading(username: string): void {
    teardownSession();
    root.replaceChildren(buildLoadingView(username));
  }

  function showEmpty(username: string): void {
    teardownSession();
    root.replaceChildren(buildEmptyView(() => showForm(username)));
  }

  function showSession(username: string, grid: ContributionGrid): void {
    teardownSession();
    const container = document.createElement("div");
    container.className = "view view-session";
    root.replaceChildren(container);
    sessionCleanup = createSession(container, username, grid, currentTheme, {
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

  applyPageTheme();
  watchTheme(applyPageTheme);

  const initialUsername = new URLSearchParams(window.location.search).get("user");
  if (initialUsername) {
    void startFlow(initialUsername);
  } else {
    showForm("");
  }
}
