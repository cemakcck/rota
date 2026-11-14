import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderIntl } from "./helpers";
import { WeatherChip } from "@/components/trip/WeatherChip";

afterEach(cleanup);

describe("weather", () => {
  it('weather chip shows high/low or "Forecast from"', () => {
    const { unmount } = renderIntl(<WeatherChip weather={{ forecast: { date: "2026-11-27", code: 61, max: 14, min: 8, rain: 80 } }} />);
    const chip = screen.getByRole("img", { name: "Rain, high 14°, low 8°, 80% chance of rain" });
    expect(chip.textContent).toBe("14°8°");
    unmount();

    renderIntl(<WeatherChip weather={{ from: "2026-12-03" }} />);
    expect(screen.getByText("Forecast from Dec 3")).toBeTruthy();
  });

  it("names the day in the header strip, in Turkish too", () => {
    renderIntl(<WeatherChip weather={{ forecast: { date: "2026-11-27", code: 0, max: 14, min: 8, rain: null } }} day="2026-11-27" />, "tr");
    expect(screen.getByRole("img", { name: "Cum: Açık, en yüksek 14°, en düşük 8°" }).textContent).toBe("Cum14°8°");
  });
});
