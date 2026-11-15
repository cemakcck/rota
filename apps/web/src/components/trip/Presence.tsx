"use client";

import { createContext, useContext, useEffect, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { isMemberColour, type MemberView } from "@rota/trip";
import { setEditing, type Peer } from "@/client/presence";
import { Avatar } from "../Avatar";
import { Icon } from "./icons";

/** Avatars shown before the rest collapse into "+N". */
const MAX_AVATARS = 5;
/** For a member whose colour is unknown (not in the trip document yet). */
const NO_COLOUR = "#57544e";

/** What rows and notes need to edit together: the document, presence, and who may edit. */
export type Collab = {
  doc: Y.Doc;
  awareness: Awareness | null;
  /** The signed-in user while edits are allowed; null means read-only. */
  editor: string | null;
  peers: Peer[];
  members: MemberView[];
};

export const CollabContext = createContext<Collab | null>(null);

export function useCollab(): Collab | null {
  return useContext(CollabContext);
}

/** A person's name and colour: the trip document's (the members list) first, then what they publish. */
export function identify(members: MemberView[], user: Peer["user"], fallback: string): { name: string; colour: string } {
  const member = members.find((m) => m.id === user.id);
  const colour = [member?.colour, user.colour].find(isMemberColour) ?? NO_COLOUR;
  return { name: member?.name || user.name || fallback, colour };
}

/** While `active`, this connection tells others it is editing `id` (a place or day). */
export function usePublishEditing(id: string, active: boolean): void {
  const awareness = useCollab()?.awareness ?? null;
  useEffect(() => {
    if (!awareness || !active) return;
    setEditing(awareness, id);
    return () => setEditing(awareness, null);
  }, [awareness, id, active]);
}

/** The first other person editing `id`, with their name and colour, if anyone is. */
export function useEditingPeer(id: string): { name: string; colour: string } | null {
  const t = useTranslations("trip");
  const collab = useCollab();
  const peer = collab?.peers.find((p) => p.editing === id);
  return peer ? identify(collab!.members, peer.user, t("someone")) : null;
}

/** The outline in a peer's colour around what they are editing. */
export const editingOutline = (peer: { colour: string } | null): CSSProperties | undefined =>
  peer ? { outline: `2px solid ${peer.colour}`, outlineOffset: -1 } : undefined;

/** "Deniz" on a tag in their colour; read out as "Deniz is editing". */
export function EditingTag({ peer }: { peer: { name: string; colour: string } }) {
  const t = useTranslations("trip");
  return (
    <span
      className="absolute -top-2.5 right-3 inline-flex h-[18px] max-w-[60%] items-center gap-1 rounded-md border bg-surface px-1.5 text-[11px] font-semibold text-ink"
      style={{ borderColor: peer.colour }}
    >
      <span aria-hidden="true" style={{ color: peer.colour }}>
        <Icon name="pencil" size={11} />
      </span>
      <span aria-hidden="true" className="truncate">
        {peer.name}
      </span>
      <span className="sr-only">{t("editingBy", { name: peer.name })}</span>
    </span>
  );
}

/**
 * Header avatars: this person first, then everyone else here now; after five, "+N" names the rest. With
 * `onOpen` they are one button, named for the trip's members, that opens the people sheet (who is on
 * the trip, roles, invites).
 */
export function Presence({
  self,
  peers,
  members,
  onOpen,
}: {
  self: MemberView | null;
  peers: Peer[];
  members: MemberView[];
  onOpen?: (from: HTMLElement) => void;
}) {
  const t = useTranslations("trip");
  const ts = useTranslations("share");
  const people = [
    ...(self ? [{ key: self.id, ...identify(members, self, t("someone")), label: t("you", { name: self.name || t("someone") }) }] : []),
    ...peers.map((p) => {
      const who = identify(members, p.user, t("someone"));
      return { key: p.user.id, ...who, label: who.name };
    }),
  ];
  const shown = people.slice(0, MAX_AVATARS);
  const rest = people.slice(MAX_AVATARS);
  // Inside a button only phrasing content is allowed: the list is spans with list roles then.
  const List = onOpen ? "span" : "ul";
  const Item = onOpen ? "span" : "li";
  const list = (
    <List role={onOpen ? "list" : undefined} aria-label={t("here")} className="flex items-center">
      {shown.map((p, i) => (
        <Item key={p.key} role={onOpen ? "listitem" : undefined} className={`flex ${i > 0 ? "-ml-1.5" : ""}`}>
          <Avatar name={p.name} colour={p.colour} label={p.label} />
        </Item>
      ))}
      {rest.length > 0 && (
        <Item role={onOpen ? "listitem" : undefined} className="-ml-1.5 flex">
          <span
            role="img"
            aria-label={t("moreHere", { count: rest.length, names: rest.map((p) => p.name).join(", ") })}
            title={rest.map((p) => p.name).join(", ")}
            className="inline-grid size-7 place-items-center rounded-full bg-line-2 text-[11px] font-semibold text-ink shadow-[0_0_0_2px_#fff]"
          >
            +{rest.length}
          </span>
        </Item>
      )}
    </List>
  );
  if (!onOpen) return list;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      // Named for who is on the trip (its content, the avatars of who is here now, is not read inside a button).
      aria-label={ts("peopleHere", { names: (members.length > 0 ? members.map((m) => m.name || t("someone")) : people.map((p) => p.name)).join(", ") })}
      title={ts("people")}
      onClick={(e) => onOpen(e.currentTarget)}
      className="flex h-9 items-center rounded-full px-1 hover:bg-hover max-lg:h-11"
    >
      {list}
    </button>
  );
}
