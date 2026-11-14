import { describe, expect, it } from "vitest";
import { MEMBER_COLOURS, isMemberColour } from "../src/colours";

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

describe("MEMBER_COLOURS", () => {
  it("has 8 distinct colours", () => {
    expect(new Set(MEMBER_COLOURS).size).toBe(8);
  });
  it.each(MEMBER_COLOURS)("%s has at least 3:1 contrast on white", (hex) => {
    expect(contrastOnWhite(hex)).toBeGreaterThanOrEqual(3);
  });
  it("isMemberColour accepts only palette members", () => {
    expect(isMemberColour(MEMBER_COLOURS[0])).toBe(true);
    expect(isMemberColour("#000000")).toBe(false);
    expect(isMemberColour(undefined)).toBe(false);
  });
});
