/**
 * GitHub's own username charset: letters, digits, hyphen; 1-39 characters.
 * The one rule every surface validates a name against before it can reach a
 * URL, a DOM node, or a tool result — the OGP Worker's share params, the
 * `/api/grid` route, both MCP tools, and the page's `start_game` tool.
 * (GitHub also forbids leading/trailing/double hyphens; that finer rule is
 * left to the upstream lookup, which answers 404.)
 */
export const GITHUB_USERNAME_PATTERN = /^[a-zA-Z0-9-]{1,39}$/;

/** True for a GitHub-shaped username. Callers never echo the value when this is false. */
export function isValidGithubUsername(value: unknown): value is string {
  return typeof value === "string" && GITHUB_USERNAME_PATTERN.test(value);
}
