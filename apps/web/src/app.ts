/**
 * Top-level view controller: builds the page shell (header / stage /
 * footer) once, swaps the stage between the username form, a loading
 * state, the "no bricks" guard screen, and a play session — and keeps
 * the `?user=` query string in sync.
 */

import type { ContributionGrid } from "@kusakuzushi/core";

import { UserNotFoundError, fetchGrid, hasBricks } from "./api";
import { createAttract } from "./attract";
import { createSession } from "./session";
import { currentTheme } from "./theme";

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

function buildShell(root: HTMLElement): HTMLElement {
  const header = document.createElement("header");
  header.className = "site-header";

  const title = document.createElement("h1");
  title.textContent = "草崩し";
  header.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = "GitHub の草を、ブロック崩しで刈り取ろう";
  header.appendChild(subtitle);

  const stage = document.createElement("main");
  stage.className = "stage";

  const footer = document.createElement("footer");
  footer.className = "site-footer";

  const credit = document.createElement("a");
  credit.href = "https://github.com/toshi0607";
  credit.target = "_blank";
  credit.rel = "noopener noreferrer";
  credit.textContent = "toshi0607";
  footer.append("made by ", credit, " ・ Chrome拡張(準備中)");

  root.replaceChildren(header, stage, footer);
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
  // canvas と同寸(アスペクト比 2:1)の枠を先に置き、
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

export function initApp(root: HTMLElement): void {
  const stage = buildShell(root);
  let sessionCleanup: (() => void) | null = null;
  let attractCleanup: (() => void) | null = null;

  function teardownSession(): void {
    sessionCleanup?.();
    sessionCleanup = null;
    attractCleanup?.();
    attractCleanup = null;
  }

  function showForm(initialUsername: string, errorMessage?: string): void {
    teardownSession();
    const { view, attractHost } = buildFormView(initialUsername, errorMessage, (username) => {
      void startFlow(username);
    });
    stage.replaceChildren(view);
    attractCleanup = createAttract(attractHost, currentTheme);
  }

  function showLoading(username: string): void {
    teardownSession();
    stage.replaceChildren(buildLoadingView(username));
  }

  function showEmpty(username: string): void {
    teardownSession();
    stage.replaceChildren(buildEmptyView(() => showForm(username)));
  }

  function showSession(username: string, grid: ContributionGrid): void {
    teardownSession();
    const container = document.createElement("div");
    container.className = "view view-session";

    const status = document.createElement("p");
    status.className = "session-status";
    status.textContent = `@${username} ― ${grid.total.toLocaleString()} contributions`;
    container.appendChild(status);

    stage.replaceChildren(container);
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

  const initialUsername = new URLSearchParams(window.location.search).get("user");
  if (initialUsername) {
    void startFlow(initialUsername);
  } else {
    showForm("");
  }
}
