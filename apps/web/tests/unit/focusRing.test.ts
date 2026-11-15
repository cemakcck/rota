import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf8");

describe("the focus ring", () => {
  it("is in the base layer, so Tailwind utilities (a white ring on the dark toast, outline-none) override it", () => {
    // Unlayered CSS beats every layer: the global ring must not be.
    const layered = /@layer base\s*{[^}]*:focus-visible\s*{\s*outline: 2px solid var\(--color-ink\);/;
    expect(css).toMatch(layered);
    const outside = css.replace(/@layer base\s*{[\s\S]*?\n}/, "");
    expect(outside).not.toMatch(/(^|\n)\s*:focus-visible\s*{/);
  });
});
