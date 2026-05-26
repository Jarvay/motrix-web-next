import { describe, expect, it } from 'vitest'

const TASK_PROXY_ORDER = ['app', 'direct', 'auto', 'manual']

function extractProxyOrder(source: string, marker: string): string[] {
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)

  const groupStart = source.lastIndexOf('<NRadioGroup', start)
  const groupEnd = source.indexOf('</NRadioGroup>', groupStart)
  expect(groupStart).toBeGreaterThanOrEqual(0)
  expect(groupEnd).toBeGreaterThan(groupStart)

  const groupSource = source.slice(groupStart, groupEnd)
  return [...groupSource.matchAll(/<NRadio(?:\s+v-if="[^"]+")?\s+value="([^"]+)"/g)].map((match) => match[1])
}

describe('task proxy mode UI', () => {
  it('orders Add Task proxy modes as App settings, Proxy off, Environment, Manual', async () => {
    const source = (await import('@/components/task/addtask/AdvancedOptions.vue?raw')).default
    expect(extractProxyOrder(source, 'name="add-task-proxy-mode"')).toEqual(TASK_PROXY_ORDER)
    expect(source).not.toContain('proxy-mode-global')
  })

  it('orders Task Detail proxy modes as App settings, Proxy off, Environment, Manual', async () => {
    const source = (await import('@/components/task/TaskDetail.vue?raw')).default
    expect(extractProxyOrder(source, 'name="task-proxy-mode"')).toEqual(TASK_PROXY_ORDER)
    expect(source).not.toContain('proxy-mode-global')
  })
})
