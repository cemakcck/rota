import * as Y from "yjs";

/** Exchange full state between two docs in both directions (no network). */
export function sync(a: Y.Doc, b: Y.Doc): void {
  const fromA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, fromA);
  Y.applyUpdate(a, fromB);
}

/** A second replica of `doc`, starting from its current state. */
export function replica(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}
