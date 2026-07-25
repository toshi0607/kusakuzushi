import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html-escape";

describe("escapeHtml", () => {
  it("escapes all five HTML special characters", () => {
    // #given
    const raw = `<script>&"'</script>`;
    // #when
    const escaped = escapeHtml(raw);
    // #then
    expect(escaped).toBe("&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;");
  });

  it("returns plain text unchanged", () => {
    // #given / #when
    const escaped = escapeHtml("toshi0607");
    // #then
    expect(escaped).toBe("toshi0607");
  });

  it("returns an empty string unchanged", () => {
    // #given / #when
    const escaped = escapeHtml("");
    // #then
    expect(escaped).toBe("");
  });
});
