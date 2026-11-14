import * as Y from "yjs";

export type Undo = {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Fires whenever the stacks change. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  destroy(): void;
};

/**
 * Per-person undo: only transactions whose origin is `userId` are tracked, so
 * undoing never reverts a collaborator's edit. Note fragments are excluded
 * (the rich-text editor has its own undo).
 */
export function createUndo(doc: Y.Doc, userId: string): Undo {
  const manager = new Y.UndoManager(
    [doc.getMap("meta"), doc.getMap("places"), doc.getMap("days"), doc.getMap("checklist")],
    { trackedOrigins: new Set([userId]), captureTimeout: 500 },
  );
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((cb) => cb());
  for (const event of ["stack-item-added", "stack-item-popped", "stack-cleared"] as const) {
    manager.on(event, notify);
  }
  return {
    undo: () => void manager.undo(),
    redo: () => void manager.redo(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    onChange(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    destroy() {
      listeners.clear();
      manager.destroy();
    },
  };
}
