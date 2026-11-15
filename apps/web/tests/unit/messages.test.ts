import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import tr from "../../messages/tr.json";

const keys = (obj: object, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe("translations", () => {
  it("en and tr have identical keys", () => {
    expect(keys(tr).sort()).toEqual(keys(en).sort());
  });

  it("Turkish copy reads naturally", () => {
    expect(tr.trip.home).toBe("Tripify — Gezilerim");
    expect(tr.trip.day).toBe("{n}. Gün"); // a heading and a label, like "Day {n}"
    expect(tr.trip.formatting).toBe("Biçimlendirme");
  });
});
