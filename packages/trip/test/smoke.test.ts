import { describe, expect, it } from "vitest";
import { TRIP_PACKAGE_VERSION } from "../src";

describe("@rota/trip", () => {
  it("exports a version string", () => {
    expect(TRIP_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
