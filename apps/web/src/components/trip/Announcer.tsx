"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { readTrip, type TripView } from "@rota/trip";
import { TAB_ORIGIN, type TripSession } from "@/client/sync/useTrip";
import { structuralChanges, type Change, type ListId } from "./plan";

/** More changes than this in one update are summarised instead of read out one by one. */
const MAX_SPOKEN = 3;

/**
 * Edits that came from someone else: not this tab's own (local) transactions, not this user's other
 * tabs, not the device's stored copy loading, and not the first load of an empty document.
 */
function fromOthers(transaction: Y.Transaction): boolean {
  const { origin } = transaction;
  if (transaction.local || origin === TAB_ORIGIN || origin instanceof IndexeddbPersistence) return false;
  return transaction.beforeState.size > 0;
}

/** The one peer (by Yjs client id) that wrote anything in the transaction, if exactly one did. */
function writer(transaction: Y.Transaction): number | null {
  const writers = [...transaction.afterState].filter(([client, clock]) => clock > (transaction.beforeState.get(client) ?? 0));
  return writers.length === 1 ? writers[0][0] : null;
}

/**
 * A polite live region for structural changes made by others ("Deniz moved Galata Tower to Day 2"). Own
 * edits are never announced: the person already knows. Who made a change comes from the place's
 * `addedBy` for additions, else from presence (the awareness state of the peer that wrote the update).
 */
export function Announcer({
  doc,
  userId,
  awareness,
  listLabel,
}: {
  doc: Y.Doc;
  userId: string | null;
  awareness: TripSession["awareness"];
  listLabel: (view: TripView, list: ListId) => string;
}) {
  const t = useTranslations("trip");
  const [message, setMessage] = useState("");
  const latest = useRef({ t, awareness, listLabel, userId });
  useEffect(() => {
    latest.current = { t, awareness, listLabel, userId };
  });

  useEffect(() => {
    let before: TripView | null = null;
    const onBefore = (transaction: Y.Transaction) => {
      before = fromOthers(transaction) ? readTrip(doc) : null;
    };
    const onAfter = (transaction: Y.Transaction) => {
      if (!before) return;
      const after = readTrip(doc);
      const changes = structuralChanges(before, after);
      before = null;
      if (changes.length === 0) return;
      const { t, awareness, listLabel, userId } = latest.current;
      const client = writer(transaction);
      const state = client === null ? undefined : (awareness?.getStates().get(client) as { user?: { id?: unknown } } | undefined);
      const actorId = typeof state?.user?.id === "string" ? state.user.id : null;
      const nameOf = (id: string | null | undefined) => after.members.find((m) => m.id === id)?.name ?? t("someone");
      const actor = (change: Change) => (change.kind === "added" && change.addedBy ? change.addedBy : actorId);
      // This user's edits from another device arrive like anyone else's, but are still their own.
      const spoken = changes.filter((c) => userId === null || actor(c) !== userId);
      if (spoken.length === 0) return;
      if (spoken.length > MAX_SPOKEN) return setMessage(t("announce.many", { count: spoken.length }));
      setMessage(
        spoken
          .map((c) => {
            const who = nameOf(actor(c));
            if (c.kind === "deleted") return t("announce.deleted", { who, place: c.place || t("unnamed") });
            if (c.kind === "reordered") return t("announce.reordered", { who, list: listLabel(after, c.list) });
            return t(`announce.${c.kind}`, { who, place: c.place || t("unnamed"), list: listLabel(after, c.list) });
          })
          .join(". "),
      );
    };
    doc.on("beforeTransaction", onBefore);
    doc.on("afterTransaction", onAfter);
    return () => {
      doc.off("beforeTransaction", onBefore);
      doc.off("afterTransaction", onAfter);
    };
  }, [doc]);

  return (
    <div data-testid="announcer" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
