/**
 * Undo/redo over PATCHES, not snapshots. docs/08 §7.2
 *
 * A 400-object plan snapshotted 50 times is tens of megabytes of duplicated
 * geometry; the patches describing those same 50 edits are bytes. Immer's
 * `produceWithPatches` hands back both the forward patches and their inverses,
 * so undo costs nothing to derive — which is why the store produces them and
 * this file only has to remember them in the right order.
 *
 * Deliberately structural: this module knows an entry has a label and two
 * opaque payloads. It does not know what a patch IS, so it carries Immer's
 * today and something else tomorrow without a rewrite, and it stays testable
 * without importing a patch library at all.
 */

export interface HistoryEntry<TPatch> {
  /** What the user did, for a menu that can say "Undo draw wall". */
  label: string
  patches: readonly TPatch[]
  inverse: readonly TPatch[]
}

export interface History<TPatch> {
  past: HistoryEntry<TPatch>[]
  future: HistoryEntry<TPatch>[]
}

/**
 * Deep enough that nobody reaches the end in a working session, bounded so a
 * long one cannot grow without limit. The oldest entries fall off the back.
 */
export const HISTORY_LIMIT = 100

export const emptyHistory = <TPatch>(): History<TPatch> => ({ past: [], future: [] })

/**
 * Records an edit.
 *
 * Recording CLEARS the redo stack, which is the universal convention and the
 * only coherent one: once you edit after undoing, the future you abandoned is
 * no longer reachable from the present.
 *
 * An entry with no patches is dropped — a drag that ended where it started
 * changed nothing, and an undo that does nothing is worse than no undo at all.
 */
export function record<TPatch>(
  history: History<TPatch>,
  entry: HistoryEntry<TPatch>,
): History<TPatch> {
  if (entry.patches.length === 0) return history
  const past = [...history.past, entry]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: [],
  }
}

export const canUndo = <TPatch>(history: History<TPatch>): boolean => history.past.length > 0
export const canRedo = <TPatch>(history: History<TPatch>): boolean => history.future.length > 0

export interface Step<TPatch> {
  history: History<TPatch>
  /** The patches to apply. Null when there was nothing to undo or redo. */
  apply: readonly TPatch[] | null
  label: string | null
}

/** Moves one entry from past to future, handing back its INVERSE to apply. */
export function undo<TPatch>(history: History<TPatch>): Step<TPatch> {
  const entry = history.past.at(-1)
  if (!entry) return { history, apply: null, label: null }

  return {
    history: {
      past: history.past.slice(0, -1),
      future: [entry, ...history.future],
    },
    apply: entry.inverse,
    label: entry.label,
  }
}

/** The mirror: future back to past, handing back the FORWARD patches. */
export function redo<TPatch>(history: History<TPatch>): Step<TPatch> {
  const [entry, ...rest] = history.future
  if (!entry) return { history, apply: null, label: null }

  return {
    history: { past: [...history.past, entry], future: rest },
    apply: entry.patches,
    label: entry.label,
  }
}

/** What an undo menu shows without having to reach into the stack. */
export const nextUndoLabel = <TPatch>(history: History<TPatch>): string | null =>
  history.past.at(-1)?.label ?? null

export const nextRedoLabel = <TPatch>(history: History<TPatch>): string | null =>
  history.future[0]?.label ?? null
