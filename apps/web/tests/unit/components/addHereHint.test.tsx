import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { MapLoaderContext } from "@/components/map/engine";
import { fakeMap } from "../map/fakeMap";
import { renderIntl } from "./helpers";
import { fake, newTrip, useFakeTrip } from "./tripHarness";

vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
vi.mock("@/client/authClient", () => ({
  useUserId: () => fake.userId,
  useUserState: () => ({ userId: fake.userId, signedOut: false }),
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { TripScreen } from "@/components/trip/TripScreen";

afterEach(cleanup);

const screenIn = (locale: "en" | "tr") =>
  renderIntl(
    <MapLoaderContext.Provider value={fakeMap().load}>
      <TripScreen tripId="t1" />
    </MapLoaderContext.Provider>,
    locale,
  );

describe("adding a place on the map", () => {
  it("is explained next to Add place, in both languages", () => {
    newTrip();
    screenIn("en");
    expect(screen.getByText("Right-click or long-press the map to add a place there.")).toBeTruthy();
    cleanup();
    newTrip();
    screenIn("tr");
    expect(screen.getByText("Oraya bir yer eklemek için haritaya sağ tıklayın veya uzun basın.")).toBeTruthy();
  });

  it("is not offered to someone who cannot edit", () => {
    newTrip();
    fake.userId = null;
    screenIn("en");
    expect(screen.queryByText("Right-click or long-press the map to add a place there.")).toBeNull();
  });
});
