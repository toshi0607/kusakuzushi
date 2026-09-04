/**
 * The page's own WebMCP tools: what only the page can do (start a game on
 * this stage) or see (the live score, lives, and harvest rate of a session
 * that exists nowhere but in this tab). The remote tools live in workers/mcp
 * and are mirrored in next to these by `register.ts`.
 *
 * Plain data in, plain data out, no DOM: everything goes through the
 * `AppController`, so the tools are tested with a stub controller and can
 * never reach the stage by a path the form does not use.
 */

import { isValidGithubUsername } from "@kusakuzushi/core/github-username";

import type { AppController, AppSnapshot } from "../app";

/** Chrome's published guidance for tool output, applied to the serialised result of every call. */
export const TOOL_OUTPUT_CHAR_LIMIT = 1500;

/** The spec surface of `ModelContext.registerTool`'s argument, kept local so the app compiles against what it uses. */
export type PageTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: { readonly readOnlyHint: boolean };
  execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export type StartGameResult =
  | { started: true; user: string }
  | { started: false; reason: string };

function guardOutput(result: Record<string, unknown>): Record<string, unknown> {
  return JSON.stringify(result).length <= TOOL_OUTPUT_CHAR_LIMIT ? result : { error: "result exceeded the output budget" };
}

/** Whether the tab is in the middle of a round the player has not finished. */
function isPlaying(snapshot: AppSnapshot): boolean {
  return snapshot.phase === "playing" || snapshot.phase === "ballLost";
}

/**
 * `start_game`: same as typing the name into the form. Refused while a
 * round is in progress — an agent's call carries no intent from the person
 * holding the paddle, and the board would be thrown away without a word —
 * and while a grid is still loading, so two loads can never race for the
 * stage (the form itself is gone during a load, so only a tool could do that).
 * The name is validated before it can reach the page, the URL, or this
 * result; an invalid one is described, never echoed.
 */
export function startGame(controller: AppController, input: Record<string, unknown>): StartGameResult {
  const user = input.user;
  if (!isValidGithubUsername(user)) {
    return { started: false, reason: "user must be a GitHub username: letters, digits, and hyphens, 1-39 characters" };
  }
  const snapshot = controller.getSnapshot();
  if (isPlaying(snapshot)) {
    return { started: false, reason: "a game is in progress on this page; wait for it to end" };
  }
  if (snapshot.phase === "loading") {
    return { started: false, reason: "a grid is still loading on this page; call get_game_state and retry" };
  }
  controller.start(user);
  return { started: true, user };
}

export function createPageTools(controller: AppController): PageTool[] {
  return [
    {
      name: "start_game",
      description:
        "Start a game of 草崩し (GitHub-contribution Breakout) on this page for a GitHub user, as if their name had been " +
        "typed into the form. Refused while a round is being played. Changes what the page shows; stores nothing.",
      inputSchema: {
        type: "object",
        properties: {
          user: { type: "string", description: "GitHub username (letters, digits, hyphens; 1-39 characters)", maxLength: 39 },
        },
        required: ["user"],
      },
      annotations: { readOnlyHint: false },
      execute: async (input) => guardOutput(startGame(controller, input)),
    },
    {
      name: "get_game_state",
      description:
        "Read the current state of the game on this page: phase (idle, loading, empty, error, ready, playing, ballLost, " +
        "gameOver, clear), user, score, harvested percent, lives, bricks left, and the year's total contributions.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => guardOutput({ ...controller.getSnapshot() }),
    },
  ];
}
