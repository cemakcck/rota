import { describe, expect, it } from "vitest";
import { normaliseTags } from "../src";

describe("tags", () => {
  it("tags are trimmed, deduplicated case-insensitively and capped at 5", () => {
    const tags = normaliseTags([
      " Rooftop",
      "rooftop",
      "  ",
      "a".repeat(30),
      "",
      "must-see ",
      "ROOFTOP ",
      "cheap",
      "view",
      "late",
      "sixth",
    ]);
    expect(tags).toEqual(["Rooftop", "a".repeat(24), "must-see", "cheap", "view"]);
    expect(tags.every((t) => t.length > 0 && t.length <= 24 && t === t.trim())).toBe(true);
  });
});
