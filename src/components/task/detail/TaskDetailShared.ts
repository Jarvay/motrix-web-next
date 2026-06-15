/** @fileoverview Shared task detail tab rendering helpers. */
import { h, type VNodeChild } from 'vue'
import { NButton, NIcon } from 'naive-ui'
import { CopyOutline } from '@vicons/ionicons5'
import MTooltip from '@/components/common/MTooltip.vue'

export function renderDetailLongText(value: string | number): VNodeChild {
  return h('span', { class: 'detail-long-text technical-text-wrap' }, String(value || '-'))
}

export function renderDetailCopyableText(options: {
  value: string | number
  label: string
  tooltip: string
  onCopy: (value: string, label: string) => void
}): VNodeChild {
  const text = String(options.value || '-')
  return h('span', { class: 'detail-copyable-value' }, [
    h('span', { class: 'detail-copyable-text technical-text-wrap' }, text),
    h(
      MTooltip,
      { placement: 'top' },
      {
        trigger: () =>
          h(
            NButton,
            {
              class: 'detail-copy-button',
              size: 'tiny',
              quaternary: true,
              focusable: false,
              onClick: () => options.onCopy(text, options.label),
            },
            {
              icon: () => h(NIcon, { size: 13 }, { default: () => h(CopyOutline) }),
            },
          ),
        default: () => options.tooltip,
      },
    ),
  ])
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}
