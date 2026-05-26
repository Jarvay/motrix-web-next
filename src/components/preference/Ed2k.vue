<script setup lang="ts">
/** @fileoverview ED2K preference tab: engine options, server discovery, and search. */
import { ref, computed, nextTick, onMounted, h } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useI18n } from 'vue-i18n'
import { useDialog } from 'naive-ui'
import {
  NButton,
  NDataTable,
  NDivider,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NInputGroup,
  NInputNumber,
  NSelect,
  NText,
} from 'naive-ui'
import { CloseOutline, DiceOutline, DownloadOutline, FolderOpenOutline, SearchOutline } from '@vicons/ionicons5'
import { usePreferenceStore } from '@/stores/preference'
import { useTaskStore } from '@/stores/task'
import { usePreferenceForm } from '@/composables/usePreferenceForm'
import { useEngineRestart } from '@/composables/useEngineRestart'
import { useAppMessage } from '@/composables/useAppMessage'
import {
  buildEd2kForm,
  buildEd2kSystemConfig,
  ED2K_SEARCH_POLL_INTERVAL_MS,
  getEd2kSearchToastKey,
  randomEd2kPort,
  shouldFinishEd2kSearchPoll,
  transformEd2kForStore,
  validateEd2kForm,
} from '@/composables/useEd2kPreference'
import { cleanupEd2kSearch, ed2kSearch, getEd2kSearchResults } from '@/api/aria2'
import { ENGINE_RPC_PORT } from '@shared/constants'
import { diffConfig, checkIsNeedRestart } from '@shared/utils/config'
import { bytesToSize } from '@shared/utils'
import { getErrorMessage } from '@shared/utils/errorMessage'
import { logger } from '@shared/logger'
import type { Ed2kSearchResult } from '@shared/types'
import PreferenceActionBar from './PreferenceActionBar.vue'

const { t } = useI18n()
const preferenceStore = usePreferenceStore()
const taskStore = useTaskStore()
const dialog = useDialog()
const message = useAppMessage()
const { restartEngine } = useEngineRestart()

const needsRestart = ref(false)
const searchKeyword = ref('')
const searchFileType = ref('')
const searchMinSources = ref<number | null>(null)
type SearchState = 'idle' | 'searching' | 'cancelling'

const searchState = ref<SearchState>('idle')
const currentSearchGid = ref('')
const searchCancelled = ref(false)
const searchCleanupDone = ref(false)
const searchResults = ref<Ed2kSearchResult[]>([])
const searchElapsedMs = ref(0)

const searchActive = computed(() => searchState.value !== 'idle')
const searchButtonText = computed(() =>
  searchActive.value ? t('preferences.ed2k-search-cancel') : t('preferences.ed2k-search-submit'),
)
const searchMaxDurationMs = computed(() => Math.max(1, Number(form.value.ed2kSearchTimeout || 20)) * 1000)
const searchElapsedSeconds = computed(() => Math.floor(searchElapsedMs.value / 1000))
const searchStatusText = computed(() =>
  searchActive.value
    ? t('preferences.ed2k-search-progress', {
        elapsed: searchElapsedSeconds.value,
        total: Math.floor(searchMaxDurationMs.value / 1000),
        count: searchResults.value.length,
      })
    : t('preferences.ed2k-search-ready', { total: Math.floor(searchMaxDurationMs.value / 1000) }),
)

const fileTypeOptions = computed(() => [
  { label: t('preferences.ed2k-search-type-any'), value: '' },
  { label: t('preferences.ed2k-search-type-audio'), value: 'audio' },
  { label: t('preferences.ed2k-search-type-video'), value: 'video' },
  { label: t('preferences.ed2k-search-type-document'), value: 'doc' },
  { label: t('preferences.ed2k-search-type-archive'), value: 'archive' },
])

function buildForm() {
  return buildEd2kForm(preferenceStore.config)
}

const { form, isDirty, handleSave, handleReset, resetSnapshot } = usePreferenceForm({
  buildForm,
  buildSystemConfig: buildEd2kSystemConfig,
  transformForStore: transformEd2kForStore,
  beforeSave: async (f) => {
    const validationKey = validateEd2kForm(f)
    if (validationKey) {
      message.error(t(validationKey))
      return false
    }

    const changed = diffConfig(preferenceStore.config, transformEd2kForStore(f))
    if (checkIsNeedRestart(changed)) {
      const ok = await new Promise<boolean>((resolve) => {
        dialog.warning({
          title: t('preferences.engine-restart-title'),
          content: t('preferences.engine-restart-confirm'),
          positiveText: t('preferences.engine-restart-now'),
          negativeText: t('app.cancel'),
          maskClosable: false,
          onPositiveClick: () => resolve(true),
          onNegativeClick: () => resolve(false),
          onClose: () => resolve(false),
        })
      })
      if (!ok) return false
      needsRestart.value = true
    }
    return true
  },
  afterSave: async (f, prevConfig) => {
    if (needsRestart.value) {
      needsRestart.value = false
      const port = (preferenceStore.config.rpcListenPort as number) || ENGINE_RPC_PORT
      const secret = (preferenceStore.config.rpcSecret as string) || ''
      message.info(t('preferences.engine-restarting'))
      await nextTick()
      await new Promise((r) => requestAnimationFrame(r))
      await restartEngine({ port, secret })
    }

    if (
      preferenceStore.config.enableUpnp &&
      (f.ed2kListenPort !== prevConfig.ed2kListenPort || f.ed2kUdpListenPort !== prevConfig.ed2kUdpListenPort)
    ) {
      await syncUpnpState(f.ed2kListenPort, f.ed2kUdpListenPort)
    }
  },
})

function onPortDice() {
  form.value.ed2kListenPort = randomEd2kPort()
}

function onUdpPortDice() {
  form.value.ed2kUdpListenPort = randomEd2kPort()
}

async function syncUpnpState(ed2kPort: number, ed2kUdpPort: number) {
  try {
    await invoke('start_upnp_mapping', {
      btPort: Number(preferenceStore.config.listenPort) || 21301,
      dhtPort: Number(preferenceStore.config.dhtListenPort) || 26701,
      ed2kPort: ed2kPort > 0 ? ed2kPort : null,
      ed2kUdpPort: ed2kUdpPort > 0 ? ed2kUdpPort : null,
    })
  } catch (e) {
    logger.warn('UPnP', `ED2K sync failed: ${getErrorMessage(e)}`)
    message.warning(t('preferences.upnp-mapping-failed'))
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollSearchResults(gid: string): Promise<Ed2kSearchResult[]> {
  let elapsedMs = 0
  let previousResultCount = -1
  let stablePolls = 0
  let latestResults: Ed2kSearchResult[] = []
  const maxDurationMs = searchMaxDurationMs.value

  while (searchState.value === 'searching') {
    await wait(ED2K_SEARCH_POLL_INTERVAL_MS)
    if (searchState.value !== 'searching') break
    elapsedMs += ED2K_SEARCH_POLL_INTERVAL_MS
    searchElapsedMs.value = Math.min(elapsedMs, maxDurationMs)

    const payload = await getEd2kSearchResults({ gid })
    latestResults = payload.results ?? []
    searchResults.value = latestResults

    const resultCount = latestResults.length
    stablePolls = resultCount === previousResultCount ? stablePolls + 1 : 0

    if (
      shouldFinishEd2kSearchPoll({
        elapsedMs,
        resultCount,
        previousResultCount,
        stablePolls,
        moreResults: typeof payload.moreResults === 'boolean' ? payload.moreResults : undefined,
        maxDurationMs,
      })
    ) {
      break
    }

    previousResultCount = resultCount
  }

  return latestResults
}

async function handleSearch() {
  const keyword = searchKeyword.value.trim()
  if (searchState.value === 'searching') {
    await handleCancelSearch()
    return
  }
  if (!keyword) {
    message.warning(t('preferences.ed2k-search-keyword-required'))
    return
  }
  if (searchState.value !== 'idle') return
  searchState.value = 'searching'
  searchCancelled.value = false
  searchCleanupDone.value = false
  searchResults.value = []
  searchElapsedMs.value = 0
  message.info(t('preferences.ed2k-search-started'))
  let gid = ''
  let outcome: 'completed' | 'cancelled' | 'failed' = 'completed'
  let resultCount = 0
  try {
    gid = await ed2kSearch({
      keyword,
      options: {
        ...(searchFileType.value ? { fileType: searchFileType.value } : {}),
        ...(searchMinSources.value ? { minSourceCount: String(searchMinSources.value) } : {}),
      },
    })
    currentSearchGid.value = gid
    searchResults.value = await pollSearchResults(gid)
    resultCount = searchResults.value.length
    if (searchCancelled.value) outcome = 'cancelled'
  } catch (e) {
    logger.debug('ED2K.search', e)
    if (!searchCancelled.value) outcome = 'failed'
    else outcome = 'cancelled'
  } finally {
    if (gid && currentSearchGid.value === gid && !searchCleanupDone.value) {
      try {
        await cleanupEd2kSearch({ gid })
        searchCleanupDone.value = true
      } catch (e) {
        logger.debug('ED2K.searchCleanup', e)
        message.warning(t('preferences.ed2k-search-cleanup-failed'))
      }
    }
    const toastKey = getEd2kSearchToastKey(outcome, resultCount)
    if (outcome === 'failed') message.error(t(toastKey))
    else if (outcome === 'cancelled' && resultCount > 0) message.success(t(toastKey, { count: resultCount }))
    else if (outcome === 'cancelled' || resultCount === 0) message.warning(t(toastKey, { count: resultCount }))
    else message.success(t(toastKey, { count: resultCount }))
    searchState.value = 'idle'
    currentSearchGid.value = ''
    searchCancelled.value = false
    searchCleanupDone.value = false
    searchElapsedMs.value = 0
  }
}

async function handleCancelSearch() {
  const gid = currentSearchGid.value
  if (searchState.value === 'cancelling') return
  searchState.value = 'cancelling'
  searchCancelled.value = true
  if (!gid) return
  try {
    await cleanupEd2kSearch({ gid })
    searchCleanupDone.value = true
  } catch (e) {
    logger.debug('ED2K.searchCancel', e)
  }
}

async function handleSelectServerList() {
  const selected = await openDialog({
    directory: false,
    multiple: false,
    filters: [{ name: 'server.met', extensions: ['met'] }],
  })
  if (typeof selected === 'string') form.value.ed2kServerList = selected
}

async function handleSelectNodeList() {
  const selected = await openDialog({
    directory: false,
    multiple: false,
    filters: [{ name: 'nodes.dat', extensions: ['dat'] }],
  })
  if (typeof selected === 'string') form.value.ed2kNodeList = selected
}

async function handleDownload(row: Ed2kSearchResult) {
  if (!row.ed2kLink) return
  try {
    await taskStore.addUri({
      uris: [row.ed2kLink],
      outs: [],
      options: { dir: preferenceStore.config.dir },
      fileCategory: {
        enabled: preferenceStore.config.fileCategoryEnabled,
        categories: preferenceStore.config.fileCategories,
      },
    })
    message.success(t('preferences.ed2k-download-started'))
  } catch (e) {
    logger.debug('ED2K.download', e)
    message.error(t('preferences.ed2k-search-failed'))
  }
}

const resultColumns = computed(() => [
  { title: t('task.file-name'), key: 'name', ellipsis: { tooltip: true } },
  {
    title: t('task.file-size'),
    key: 'length',
    width: 110,
    align: 'right' as const,
    render: (row: Ed2kSearchResult) => bytesToSize(String(row.length ?? 0)),
  },
  {
    title: t('preferences.ed2k-search-sources'),
    key: 'sourceCount',
    width: 92,
    align: 'right' as const,
  },
  {
    title: t('preferences.ed2k-search-complete-sources'),
    key: 'completeSourceCount',
    width: 112,
    align: 'right' as const,
  },
  {
    title: '',
    key: 'actions',
    width: 58,
    align: 'center' as const,
    render: (row: Ed2kSearchResult) => {
      return row.ed2kLink
        ? h(
            NButton,
            { size: 'tiny', quaternary: true, onClick: () => handleDownload(row) },
            {
              icon: () => h(NIcon, null, { default: () => h(DownloadOutline) }),
            },
          )
        : null
    },
  },
])

function handleManualRestart() {
  const port = (preferenceStore.config.rpcListenPort as number) || ENGINE_RPC_PORT
  const secret = (preferenceStore.config.rpcSecret as string) || ''
  const d = dialog.warning({
    title: t('preferences.engine-restart-title'),
    content: t('preferences.engine-restart-manual-confirm'),
    positiveText: t('preferences.engine-restart-now'),
    negativeText: t('preferences.engine-restart-later'),
    maskClosable: false,
    onPositiveClick: async () => {
      d.loading = true
      d.negativeText = ''
      d.closable = false
      message.info(t('preferences.engine-restarting'))
      await new Promise((r) => requestAnimationFrame(r))
      await restartEngine({ port, secret })
    },
  })
}

onMounted(() => {
  Object.assign(form.value, buildForm())
  resetSnapshot()
})
</script>

<template>
  <div class="preference-form-wrapper">
    <NForm label-placement="left" label-align="left" label-width="260px" size="small" class="form-preference">
      <NDivider title-placement="left">{{ t('preferences.ed2k-settings') }}</NDivider>
      <NFormItem :label="t('preferences.ed2k-listen-port')">
        <NInputGroup>
          <NInputNumber v-model:value="form.ed2kListenPort" :min="0" :max="65535" style="width: 160px" />
          <NButton secondary @click="onPortDice">
            <template #icon>
              <NIcon><DiceOutline /></NIcon>
            </template>
            {{ t('preferences.ed2k-random-port') }}
          </NButton>
        </NInputGroup>
      </NFormItem>
      <NFormItem :label="t('preferences.ed2k-udp-listen-port')">
        <NInputGroup>
          <NInputNumber v-model:value="form.ed2kUdpListenPort" :min="0" :max="65535" style="width: 160px" />
          <NButton secondary @click="onUdpPortDice">
            <template #icon>
              <NIcon><DiceOutline /></NIcon>
            </template>
            {{ t('preferences.ed2k-random-port') }}
          </NButton>
        </NInputGroup>
      </NFormItem>
      <NFormItem :label="t('preferences.ed2k-server')">
        <NInput
          v-model:value="form.ed2kServer"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          :placeholder="t('preferences.ed2k-server-placeholder')"
        />
      </NFormItem>
      <NFormItem :label="t('preferences.ed2k-server-list')">
        <NInputGroup>
          <NInput v-model:value="form.ed2kServerList" readonly style="flex: 1" placeholder="/path/to/server.met" />
          <NButton style="padding: 0 12px" @click="handleSelectServerList">
            <template #icon>
              <NIcon :size="16"><FolderOpenOutline /></NIcon>
            </template>
          </NButton>
          <NButton v-if="form.ed2kServerList" quaternary style="padding: 0 10px" @click="form.ed2kServerList = ''">
            <template #icon>
              <NIcon :size="16"><CloseOutline /></NIcon>
            </template>
          </NButton>
        </NInputGroup>
      </NFormItem>
      <NFormItem :label="t('preferences.ed2k-node-list')">
        <NInputGroup>
          <NInput v-model:value="form.ed2kNodeList" readonly style="flex: 1" placeholder="/path/to/nodes.dat" />
          <NButton style="padding: 0 12px" @click="handleSelectNodeList">
            <template #icon>
              <NIcon :size="16"><FolderOpenOutline /></NIcon>
            </template>
          </NButton>
          <NButton v-if="form.ed2kNodeList" quaternary style="padding: 0 10px" @click="form.ed2kNodeList = ''">
            <template #icon>
              <NIcon :size="16"><CloseOutline /></NIcon>
            </template>
          </NButton>
        </NInputGroup>
      </NFormItem>
      <NFormItem :label="t('preferences.ed2k-upload-slots')">
        <NInputNumber v-model:value="form.ed2kUploadSlots" :min="1" :max="100" style="width: 160px" />
      </NFormItem>
      <NFormItem :label="t('preferences.ed2k-share-files')">
        <NInput
          v-model:value="form.ed2kShareFiles"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          :placeholder="t('preferences.ed2k-share-files-placeholder')"
        />
      </NFormItem>

      <NDivider title-placement="left">{{ t('preferences.ed2k-search') }}</NDivider>
      <NFormItem :label="t('preferences.ed2k-search-keyword')">
        <NInput v-model:value="searchKeyword" :disabled="searchActive" @keyup.enter="handleSearch" />
      </NFormItem>
      <NFormItem label=" ">
        <div class="ed2k-search-actions">
          <NButton
            class="ed2k-search-button"
            :class="{ 'ed2k-search-button--active': searchActive }"
            type="primary"
            :disabled="searchState === 'cancelling'"
            @click="handleSearch"
          >
            <template #icon>
              <span class="ed2k-search-icon-stack" aria-hidden="true">
                <Transition name="ed2k-search-icon">
                  <span v-if="searchActive" class="ed2k-search-icon-layer">
                    <span class="ed2k-search-spinner" />
                  </span>
                </Transition>
                <Transition name="ed2k-search-icon">
                  <span v-if="!searchActive" class="ed2k-search-icon-layer">
                    <NIcon><SearchOutline /></NIcon>
                  </span>
                </Transition>
              </span>
            </template>
            <Transition name="ed2k-search-label" mode="out-in">
              <span :key="searchButtonText">{{ searchButtonText }}</span>
            </Transition>
          </NButton>
          <Transition name="ed2k-search-status" mode="out-in">
            <NText :key="searchState" depth="3" class="ed2k-search-status">{{ searchStatusText }}</NText>
          </Transition>
        </div>
      </NFormItem>
      <NFormItem :label="t('preferences.ed2k-search-type')">
        <NSelect v-model:value="searchFileType" :options="fileTypeOptions" style="width: 220px" />
      </NFormItem>
      <NFormItem :label="t('preferences.ed2k-search-min-sources')">
        <NInputNumber v-model:value="searchMinSources" :min="1" :max="9999" style="width: 160px" />
      </NFormItem>
      <NFormItem :label="t('preferences.ed2k-search-timeout')">
        <NInputNumber v-model:value="form.ed2kSearchTimeout" :min="10" :max="600" style="width: 160px" />
        <NText depth="3" style="font-size: 12px; margin-left: 8px">{{ t('preferences.unit-seconds') }}</NText>
      </NFormItem>
      <NFormItem :show-label="false">
        <NDataTable
          class="search-results"
          size="small"
          :columns="resultColumns"
          :data="searchResults"
          :bordered="true"
          :pagination="{ pageSize: 8 }"
        />
      </NFormItem>
    </NForm>
    <PreferenceActionBar :is-dirty="isDirty" @save="handleSave" @discard="handleReset" @restart="handleManualRestart" />
  </div>
</template>

<style scoped>
.preference-form-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.form-preference {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 30px 64px 36px;
}
.form-preference :deep(.n-form-item) {
  padding-left: 50px;
}
.search-results {
  width: 100%;
  min-width: 0;
}
.ed2k-search-button {
  min-width: 104px;
  overflow: hidden;
}
.ed2k-search-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
}
.ed2k-search-status {
  display: inline-flex;
  min-width: 240px;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
}
.ed2k-search-icon-stack {
  position: relative;
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  align-items: center;
  justify-content: center;
}
.ed2k-search-icon-layer {
  position: absolute;
  inset: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  will-change: opacity, transform;
}
.ed2k-search-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: ed2k-search-spin 0.8s linear infinite;
  will-change: transform;
  contain: layout style paint;
}
.ed2k-search-icon-enter-active {
  animation: ed2k-search-icon-in 0.3s cubic-bezier(0.2, 0, 0, 1) both;
}
.ed2k-search-icon-leave-active {
  animation: ed2k-search-icon-out 0.26s cubic-bezier(0.4, 0, 0.2, 1) both;
}
.ed2k-search-label-enter-active,
.ed2k-search-label-leave-active {
  transition:
    opacity 0.22s cubic-bezier(0.2, 0, 0, 1),
    transform 0.22s cubic-bezier(0.2, 0, 0, 1);
}
.ed2k-search-status-enter-active,
.ed2k-search-status-leave-active {
  transition: opacity 0.22s cubic-bezier(0.2, 0, 0, 1);
}
.ed2k-search-label-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.ed2k-search-label-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.ed2k-search-status-enter-from,
.ed2k-search-status-leave-to {
  opacity: 0;
}
@keyframes ed2k-search-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
@keyframes ed2k-search-icon-in {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes ed2k-search-icon-out {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.7);
  }
}
</style>
