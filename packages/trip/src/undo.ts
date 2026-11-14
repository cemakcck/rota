import * as Y from "yjs";

/** An opaque handle on one undo step (see Undo.mark). */
export type UndoMark = { readonly __undoMark: unique symbol };

export type Undo = {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Ends the current undo step: the next change undoes on its own, even within the 500 ms merge window. */
  stopCapturing(): void;
  /**
   * The step on top of this person's undo stack (null when there is none): taken right after an action,
   * it names that action's step, for an Undo that must revert exactly it.
   */
  mark(): UndoMark | null;
  /**
   * Undoes the marked step only while it is still on top (nothing of this person's since), and only it:
   * if friends have since overwritten all it changed, nothing changes. True if it was on top.
   */
  undoMark(mark: UndoMark): boolean;
  /**
   * Runs one action of this person's as its own undo step (stopCapturing before and after) and returns its
   * result; `lastStep` then marks that step, or is null if it changed nothing.
   */
  step<T>(run: () => T): T;
  /** The mark of the last `step` (null when it changed nothing). */
  lastStep(): UndoMark | null;
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
  const top = () => (manager.undoStack.at(-1) as unknown as UndoMark | undefined) ?? null;
  let last: UndoMark | null = null;
  const notify = () => listeners.forEach((cb) => cb());
  for (const event of ["stack-item-added", "stack-item-popped", "stack-cleared"] as const) {
    manager.on(event, notify);
  }
  return {
    undo: () => void manager.undo(),
    redo: () => void manager.redo(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    stopCapturing: () => manager.stopCapturing(),
    mark: top,
    step(run) {
      manager.stopCapturing();
      const before = top();
      try {
        return run();
      } finally {
        manager.stopCapturing();
        const after = top();
        last = after !== before ? after : null;
      }
    },
    lastStep: () => last,
    undoMark(mark) {
      if (manager.undoStack.at(-1) !== (mark as unknown)) return false;
      // Y.UndoManager.undo() pops until something changes: a step a friend fully overwrote would let it
      // go on to undo the step before. Only the marked step is offered to it; the rest goes back after.
      const earlier = manager.undoStack.slice(0, -1);
      manager.undoStack = manager.undoStack.slice(-1);
      try {
        manager.undo();
      } finally {
        manager.undoStack = [...earlier, ...manager.undoStack];
      }
      return true;
    },
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
