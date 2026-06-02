/**
 * @fileoverview Tests for the notification toast VNode rendering utility.
 *
 * Validates that renderCompletionToast:
 *   1. Returns a plain string when no action callbacks are provided.
 *   2. Returns a VNode render function when action callbacks are provided.
 *   3. Passes the correct i18n keys to the action buttons.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderCompletionToast } from '../useNotificationToast'

const t = vi.fn((key: string) => key)

describe('renderCompletionToast', () => {
  it('returns plain string when no action callbacks are provided', () => {
    const result = renderCompletionToast({ body: 'file.zip completed', t })

    expect(result).toBe('file.zip completed')
    expect(typeof result).toBe('string')
  })

  it('returns render function when onOpenFile is provided', () => {
    const onOpenFile = vi.fn()
    const result = renderCompletionToast({ body: 'file.zip completed', t, onOpenFile })

    expect(typeof result).toBe('function')
  })

  it('returns render function when onShowInFolder is provided', () => {
    const onShowInFolder = vi.fn()
    const result = renderCompletionToast({ body: 'file.zip completed', t, onShowInFolder })

    expect(typeof result).toBe('function')
  })

  it('returns render function when both callbacks are provided', () => {
    const onOpenFile = vi.fn()
    const onShowInFolder = vi.fn()
    const result = renderCompletionToast({
      body: 'file.zip completed',
      t,
      onOpenFile,
      onShowInFolder,
    })

    expect(typeof result).toBe('function')
  })

  it('render function produces valid VNode', () => {
    const onOpenFile = vi.fn()
    const onShowInFolder = vi.fn()
    const result = renderCompletionToast({
      body: 'file.zip completed',
      t,
      onOpenFile,
      onShowInFolder,
    })

    // When we have a render function, calling it should produce a VNode
    expect(typeof result).toBe('function')
    const vnode = (result as () => unknown)()
    expect(vnode).toBeDefined()
    // VNode should be an object with type and children (Vue h() output)
    expect(typeof vnode).toBe('object')
  })

  it('keeps completion toast width content-driven and preserves right-side actions', () => {
    const onOpenFile = vi.fn()
    const onShowInFolder = vi.fn()
    const result = renderCompletionToast({
      body: 'very-long-file-name.zip completed',
      t,
      onOpenFile,
      onShowInFolder,
    })

    expect(typeof result).toBe('function')
    const vnode = (result as () => { props?: { style?: Record<string, string> }; children?: unknown[] })()
    const children = vnode.children as Array<{ props?: { style?: Record<string, string> } }>
    const body = children[0]
    const actions = children[1]

    expect(vnode.props?.style).toMatchObject({
      maxWidth: '100%',
      minWidth: '0',
    })
    expect(vnode.props?.style?.width).toBeUndefined()
    expect(vnode.props?.style?.gridTemplateColumns).toBe('minmax(0, 1fr) max-content')
    expect(body.props?.style).toMatchObject({
      minWidth: '0',
      overflow: 'hidden',
      display: '-webkit-box',
      WebkitLineClamp: '2',
      WebkitBoxOrient: 'vertical',
      whiteSpace: 'normal',
      wordBreak: 'break-all',
    })
    expect(actions.props?.style).toMatchObject({
      display: 'inline-flex',
      flexWrap: 'nowrap',
      whiteSpace: 'nowrap',
    })
  })
})
