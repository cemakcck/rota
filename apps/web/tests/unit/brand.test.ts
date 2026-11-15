import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(`${import.meta.dirname}/../../${p}`, "utf8");

describe("brand", () => {
  it("no user-visible file says Rota", () => {
    for (const file of ["messages/en.json", "messages/tr.json", "public/manifest.webmanifest", "public/offline.html"]) {
      expect(read(file), file).not.toMatch(/Rota/);
    }
  });

  it("the manifest is named Tripify", () => {
    expect(JSON.parse(read("public/manifest.webmanifest"))).toMatchObject({ name: "Tripify", short_name: "Tripify" });
  });

  it("the page metadata title is Tripify in both languages", () => {
    expect(JSON.parse(read("messages/en.json")).metadata.title).toBe("Tripify");
    expect(JSON.parse(read("messages/tr.json")).metadata.title).toBe("Tripify");
  });
});
