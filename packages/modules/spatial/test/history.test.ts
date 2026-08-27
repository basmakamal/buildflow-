import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  emptyHistory,
  nextRedoLabel,
  nextUndoLabel,
  record,
  redo,
  undo,
} from '../src/domain/history'

/**
 * The undo stack, tested with string "patches" — the module is deliberately
 * agnostic about what a patch is, so these tests need no patch library and
 * would still pass if Immer were swapped out tomorrow.
 */

const entry = (label: string) => ({
  label,
  patches: [`do:${label}`],
  inverse: [`undo:${label}`],
})

describe('recording', () => {
  it('stacks edits and reports what undo would do', () => {
    const history = record(record(emptyHistory<string>(), entry('draw wall')), entry('move wall'))
    expect(history.past).toHaveLength(2)
    expect(canUndo(history)).toBe(true)
    expect(canRedo(history)).toBe(false)
    expect(nextUndoLabel(history)).toBe('move wall')
  })

  it('drops an edit that changed nothing', () => {
    // A drag that ended where it started: an undo that does nothing is worse
    // than no undo at all.
    const history = record(emptyHistory<string>(), { label: 'noop', patches: [], inverse: [] })
    expect(history.past).toHaveLength(0)
    expect(canUndo(history)).toBe(false)
  })

  it('bounds the stack so a long session cannot grow without limit', () => {
    let history = emptyHistory<string>()
    for (let index = 0; index < HISTORY_LIMIT + 20; index += 1) {
      history = record(history, entry(`edit ${String(index)}`))
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT)
    // The oldest fell off the back; the newest is still there.
    expect(history.past[0]!.label).toBe('edit 20')
    expect(nextUndoLabel(history)).toBe(`edit ${String(HISTORY_LIMIT + 19)}`)
  })
})

describe('undo and redo', () => {
  it('hands back the inverse to apply and moves the entry to the future', () => {
    const history = record(emptyHistory<string>(), entry('draw wall'))
    const step = undo(history)

    expect(step.apply).toEqual(['undo:draw wall'])
    expect(step.label).toBe('draw wall')
    expect(canUndo(step.history)).toBe(false)
    expect(canRedo(step.history)).toBe(true)
    expect(nextRedoLabel(step.history)).toBe('draw wall')
  })

  it('hands back the forward patches on redo', () => {
    const undone = undo(record(emptyHistory<string>(), entry('draw wall')))
    const step = redo(undone.history)

    expect(step.apply).toEqual(['do:draw wall'])
    expect(canUndo(step.history)).toBe(true)
    expect(canRedo(step.history)).toBe(false)
  })

  it('unwinds and rewinds several edits in order', () => {
    let history = record(emptyHistory<string>(), entry('one'))
    history = record(history, entry('two'))
    history = record(history, entry('three'))

    const first = undo(history)
    const second = undo(first.history)
    expect([first.apply, second.apply]).toEqual([['undo:three'], ['undo:two']])

    const back = redo(second.history)
    expect(back.apply).toEqual(['do:two'])
    expect(nextRedoLabel(back.history)).toBe('three')
  })

  it('abandons the future once you edit after undoing', () => {
    // The universal convention, and the only coherent one: the branch you
    // walked away from is no longer reachable from the present.
    const history = record(record(emptyHistory<string>(), entry('one')), entry('two'))
    const undone = undo(history)
    expect(canRedo(undone.history)).toBe(true)

    const edited = record(undone.history, entry('three'))
    expect(canRedo(edited)).toBe(false)
    expect(edited.past.map((item) => item.label)).toEqual(['one', 'three'])
  })

  it('does nothing at either end rather than throwing', () => {
    const empty = emptyHistory<string>()
    expect(undo(empty).apply).toBeNull()
    expect(redo(empty).apply).toBeNull()
    expect(undo(empty).history).toBe(empty)
  })
})
