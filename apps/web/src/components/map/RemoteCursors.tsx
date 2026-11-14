"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { Awareness } from "y-protocols/awareness";
import { usePeers, type Peer } from "@/client/presence";
import type { MapView } from "./engine";

/** For someone who has not picked a colour yet. */
const FALLBACK = "#57544e";

/**
 * Friends' pointers on the map (spec §9): an arrow and name in their colour, at the latitude and
 * longitude they point at, re-projected on every frame the map moves; hidden when they leave the map
 * or point outside this view. Decorative (who is here is in the header). It subscribes to presence
 * itself, so cursor moves re-render only this layer.
 */
export function RemoteCursors({ map, awareness, userId }: { map: MapView; awareness: Awareness | null; userId: string | null }) {
  const peers = usePeers(awareness, userId).filter((p) => p.cursor !== null);
  const shown = useRef<Peer[]>([]);
  const elements = useRef(new Map<number, HTMLDivElement>());

  // Positions are set directly on the elements: map frames come faster than React should render.
  const place = useCallback(() => {
    const { width, height } = map.size();
    for (const peer of shown.current) {
      const el = elements.current.get(peer.clientId);
      if (!el || !peer.cursor) continue;
      const { x, y } = map.project(peer.cursor);
      el.hidden = x < 0 || y < 0 || x > width || y > height;
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }, [map]);

  useLayoutEffect(() => {
    shown.current = peers;
    place();
  });
  useEffect(() => map.onMove(place), [map, place]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
      {peers.map((peer) => (
        <div
          key={peer.clientId}
          data-cursor={peer.user.id}
          ref={(el) => {
            if (el) elements.current.set(peer.clientId, el);
            else elements.current.delete(peer.clientId);
          }}
          className="absolute left-0 top-0"
        >
          <svg width="60" height="40" viewBox="0 0 60 40" className="overflow-visible">
            <path
              d="M0 0 L0 17 L4.6 12.8 L7.8 20 L10.6 18.8 L7.5 11.8 L13.5 11.6 Z"
              fill={peer.user.colour || FALLBACK}
              stroke="#fff"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className="absolute left-3 top-[18px] max-w-40 truncate whitespace-nowrap rounded-full px-2 text-[11px] font-semibold leading-5 text-white"
            style={{ background: peer.user.colour || FALLBACK }}
          >
            {peer.user.name}
          </span>
        </div>
      ))}
    </div>
  );
}
