import { describe, expect, it } from "vitest";
import { demoLimitApplies } from "@/server/demoLimit";

describe("demoLimitApplies", () => {
  it("applies by default", () => {
    expect(demoLimitApplies({ NODE_ENV: "development" })).toBe(true);
  });

  it("is skipped locally when DEMO_RATE_LIMIT=off", () => {
    expect(demoLimitApplies({ NODE_ENV: "development", DEMO_RATE_LIMIT: "off" })).toBe(false);
  });

  it("always applies in production, even when DEMO_RATE_LIMIT=off", () => {
    expect(demoLimitApplies({ NODE_ENV: "production", DEMO_RATE_LIMIT: "off" })).toBe(true);
  });

  it("ignores any value other than off", () => {
    expect(demoLimitApplies({ NODE_ENV: "development", DEMO_RATE_LIMIT: "0" })).toBe(true);
  });
});
