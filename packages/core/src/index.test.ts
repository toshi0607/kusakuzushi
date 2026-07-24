import { describe, it, expect } from "vitest";
import { VERSION } from "./index";

describe("@kusakuzushi/core", () => {
  it("VERSION is defined", () => {
    expect(VERSION).toBeDefined();
    expect(VERSION).toBe("0.0.1");
  });
});
