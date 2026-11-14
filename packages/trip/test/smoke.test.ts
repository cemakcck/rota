import { describe, expect, it } from "vitest";
import { TRIP_PACKAGE_VERSION } from "../src";

describe("@rota/trip", () => {
  it("exports a version string", () => {
    expect(TRIP_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("test environment", () => {
  it("runs in America/New_York", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
  });
});
