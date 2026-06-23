import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markAppClipboardText, shouldIgnoreClipboardTextForAutoDetect, writeAppClipboardText } from '../clipboard'

describe('clipboard ownership', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    })
    markAppClipboardText('')
  })

  it('suppresses auto-detection for text written by the app', async () => {
    await writeAppClipboardText('https://example.com/file.zip')

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/file.zip')
    expect(shouldIgnoreClipboardTextForAutoDetect('https://example.com/file.zip')).toBe(true)
  })

  it('does not suppress different external clipboard text', () => {
    markAppClipboardText('https://example.com/app.zip')

    expect(shouldIgnoreClipboardTextForAutoDetect('https://example.com/external.zip')).toBe(false)
  })
})
