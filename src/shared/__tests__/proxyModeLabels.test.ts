import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCALES_DIR = join(__dirname, '..', 'locales')

function localeValue(locale: string, file: 'task' | 'preferences', key: string): string {
  const source = readFileSync(join(LOCALES_DIR, locale, `${file}.js`), 'utf-8')
  const match = source.match(new RegExp(`^  '${key}': '([^']*)',`, 'm'))
  expect(match, `${locale}/${file}.js missing ${key}`).not.toBeNull()
  return match![1]
}

describe('proxy mode labels', () => {
  it('uses short task labels for the task-level proxy selector', () => {
    expect(localeValue('en-US', 'task', 'proxy-mode-app')).toBe('App settings')
    expect(localeValue('en-US', 'task', 'proxy-mode-direct')).toBe('Proxy off')
    expect(localeValue('en-US', 'task', 'proxy-mode-auto')).toBe('Environment')
    expect(localeValue('en-US', 'task', 'proxy-mode-manual')).toBe('Manual')
    expect(localeValue('en-US', 'task', 'use-proxy')).toBe('Enable proxy')

    expect(localeValue('zh-CN', 'task', 'proxy-mode-app')).toBe('软件设置')
    expect(localeValue('zh-CN', 'task', 'proxy-mode-direct')).toBe('关闭代理')
    expect(localeValue('zh-CN', 'task', 'proxy-mode-auto')).toBe('继承环境')
    expect(localeValue('zh-CN', 'task', 'proxy-mode-manual')).toBe('手动代理')
    expect(localeValue('zh-CN', 'task', 'use-proxy')).toBe('启用代理')

    expect(localeValue('zh-TW', 'task', 'proxy-mode-app')).toBe('軟體設定')
    expect(localeValue('zh-TW', 'task', 'proxy-mode-direct')).toBe('關閉代理')
    expect(localeValue('zh-TW', 'task', 'proxy-mode-auto')).toBe('繼承環境')
    expect(localeValue('zh-TW', 'task', 'proxy-mode-manual')).toBe('手動代理')
    expect(localeValue('zh-TW', 'task', 'use-proxy')).toBe('啟用代理')
  })

  it('uses explicit settings labels for the download proxy selector', () => {
    expect(localeValue('en-US', 'preferences', 'proxy-mode-direct')).toBe('Proxy off')
    expect(localeValue('en-US', 'preferences', 'proxy-mode-auto')).toBe('Environment')
    expect(localeValue('en-US', 'preferences', 'proxy-mode-manual')).toBe('Manual proxy')

    expect(localeValue('zh-CN', 'preferences', 'proxy-mode-direct')).toBe('关闭代理')
    expect(localeValue('zh-CN', 'preferences', 'proxy-mode-auto')).toBe('继承环境')
    expect(localeValue('zh-CN', 'preferences', 'proxy-mode-manual')).toBe('手动代理')

    expect(localeValue('zh-TW', 'preferences', 'proxy-mode-direct')).toBe('關閉代理')
    expect(localeValue('zh-TW', 'preferences', 'proxy-mode-auto')).toBe('繼承環境')
    expect(localeValue('zh-TW', 'preferences', 'proxy-mode-manual')).toBe('手動代理')
  })
})
