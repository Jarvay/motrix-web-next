import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useTaskStore } from '@/stores/task'
import { usePreferenceStore } from '@/stores/preference'
import type { Aria2Task } from '@shared/types'

vi.mock('@formkit/auto-animate', () => ({
  autoAnimate: vi.fn(() => ({
    enable: vi.fn(),
    disable: vi.fn(),
    destroy: vi.fn(),
  })),
}))

const { useSortableMock } = vi.hoisted(() => ({ useSortableMock: vi.fn() }))

vi.mock('@vueuse/integrations/useSortable', () => ({
  moveArrayElement: vi.fn(),
  useSortable: useSortableMock,
}))

vi.mock('../TaskItem.vue', () => ({
  default: { name: 'TaskItem', props: ['task'], template: '<div class="full-task-item" />' },
}))

vi.mock('../TaskCompactItem.vue', () => ({
  default: { name: 'TaskCompactItem', props: ['task'], template: '<div class="compact-task-item" />' },
}))

import TaskList from '../TaskList.vue'

function createTask(): Aria2Task {
  return {
    gid: 'gid-1',
    status: 'active',
    totalLength: '100',
    completedLength: '25',
    uploadLength: '0',
    downloadSpeed: '10',
    uploadSpeed: '0',
    connections: '1',
    dir: '/downloads',
    files: [],
    errorMessage: '',
  }
}

function createTaskWithGid(gid: string): Aria2Task {
  return { ...createTask(), gid }
}

describe('TaskList', () => {
  let pinia: Pinia

  beforeEach(() => {
    vi.clearAllMocks()
    pinia = createPinia()
    setActivePinia(pinia)
  })

  it('renders full task cards by default', async () => {
    const wrapper = mount(TaskList, {
      global: {
        plugins: [pinia],
      },
    })
    const taskStore = useTaskStore()
    taskStore.taskList = [createTask()]
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.full-task-item').exists()).toBe(true)
    expect(wrapper.find('.compact-task-item').exists()).toBe(false)
  })

  it('renders compact task cards when taskCardMode is compact', async () => {
    const wrapper = mount(TaskList, {
      global: {
        plugins: [pinia],
      },
    })
    const taskStore = useTaskStore()
    const preferenceStore = usePreferenceStore()
    preferenceStore.updatePreference({ taskCardMode: 'compact' })
    taskStore.taskList = [createTask()]

    await wrapper.vm.$nextTick()

    expect(wrapper.find('.compact-task-item').exists()).toBe(true)
    expect(wrapper.find('.full-task-item').exists()).toBe(false)
  })

  it('renders only the current task page', async () => {
    const wrapper = mount(TaskList, {
      global: {
        plugins: [pinia],
      },
    })
    const taskStore = useTaskStore()
    taskStore.setTaskPageSize(2)
    taskStore.taskList = ['a', 'b', 'c', 'd', 'e'].map(createTaskWithGid)
    taskStore.taskPagination.active.total = 5
    taskStore.taskPagination.active.loaded = true
    taskStore.setTaskPage('active', 2)

    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.full-task-item')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('a')
  })

  it('saves page-local drag order through the store', async () => {
    const wrapper = mount(TaskList, {
      global: {
        plugins: [pinia],
      },
    })
    const taskStore = useTaskStore()
    const saveSpy = vi.spyOn(taskStore, 'saveVisiblePageManualOrder').mockResolvedValue(undefined)
    taskStore.setTaskPageSize(2)
    taskStore.taskList = ['a', 'b', 'c', 'd'].map(createTaskWithGid)
    taskStore.taskPagination.active.total = 4
    taskStore.taskPagination.active.loaded = true
    taskStore.setTaskPage('active', 2)
    await wrapper.vm.$nextTick()

    const sortableOptions = useSortableMock.mock.calls[0]?.[2] as { onEnd?: () => Promise<void> }
    await sortableOptions.onEnd?.()

    expect(saveSpy).toHaveBeenCalledWith([expect.objectContaining({ gid: 'c' }), expect.objectContaining({ gid: 'd' })])
  })
})
