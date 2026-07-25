/**
 * Escapes the five HTML special characters. Every place that interpolates
 * templated or user-controlled text into HTML/SVG markup in this Worker goes
 * through this function — even the GitHub username, whose charset is already
 * restricted to `[a-zA-Z0-9-]` — so nothing downstream ever relies on the
 * validator alone to keep markup well-formed.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
