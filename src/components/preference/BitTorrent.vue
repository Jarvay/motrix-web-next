<script setup lang="ts">
/** @fileoverview BitTorrent preference tab: BT settings + tracker management. */
import { ref, computed, onMounted, h, nextTick } from 'vue'
import type { VNodeChild } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useI18n } from 'vue-i18n'
import { usePreferenceStore } from '@/stores/preference'
import { usePreferenceForm } from '@/composables/usePreferenceForm'
import { useEngineRestart } from '@/composables/useEngineRestart'
import { changeGlobalOption, isEngineReady } from '@/api/aria2'
import { convertTrackerDataToComma, convertTrackerDataToLine, reduceTrackerString } from '@shared/utils/tracker'
import { diffConfig, checkIsNeedRestart } from '@shared/utils/config'
import { SYNC_MIN_DURATION } from '@shared/timing'
import {
  DEFAULT_TRACKER_SOURCE,
  ENGINE_MAX_BT_MAX_PEERS,
  ENGINE_RPC_PORT,
  SAFE_LIMIT_BT_MAX_PEERS,
} from '@shared/constants'
import { logger } from '@shared/logger'
import { useAppMessage } from '@/composables/useAppMessage'
import {
  buildBtForm,
  buildBtSystemConfig,
  transformBtForStore,
  isValidTrackerSourceUrl,
} from '@/composables/useBtPreference'
import { trackerSourceOptions } from '@shared/constants/trackerSources'
import {
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NInputGroup,
  NSwitch,
  NSelect,
  NButton,
  NDivider,
  NIcon,
  useDialog,
} from 'naive-ui'
import PreferenceActionBar from './PreferenceActionBar.vue'
import PreferenceCheckboxGrid from './PreferenceCheckboxGrid.vue'
import { SyncOutline, AddCircleOutline, CloseCircleOutline } from '@vicons/ionicons5'

const { t } = useI18n()
const preferenceStore = usePreferenceStore()
const dialog = useDialog()
const message = useAppMessage()
const DHT_NETWORK_IPV4 = 'ipv4'
const DHT_NETWORK_IPV6 = 'ipv6'

const syncingTracker = ref(false)
const customTrackerInput = ref('')
const needsRestart = ref(false)
const syncIntervalOptions = computed(() => [
  { label: t('preferences.interval-every-startup'), value: 0 },
  { label: t('preferences.interval-6-hours'), value: 6 },
  { label: t('preferences.interval-12-hours'), value: 12 },
  { label: t('preferences.interval-daily'), value: 24 },
  { label: t('preferences.interval-weekly'), value: 168 },
])
const dhtNetworkOptions = computed(() => [
  { label: t('preferences.bt-dht-ipv4'), value: DHT_NETWORK_IPV4 },
  { label: t('preferences.bt-dht-ipv6'), value: DHT_NETWORK_IPV6 },
])
const selectedDhtNetworks = computed({
  get: () => {
    const values: string[] = []
    if (form.value.btDhtIpv4Enabled) values.push(DHT_NETWORK_IPV4)
    if (form.value.btDhtIpv6Enabled) values.push(DHT_NETWORK_IPV6)
    return values
  },
  set: (values: string[]) => {
    form.value.btDhtIpv4Enabled = values.includes(DHT_NETWORK_IPV4)
    form.value.btDhtIpv6Enabled = values.includes(DHT_NETWORK_IPV6)
  },
})

// ── Tracker source management ───────────────────────────────────────
const presetTrackerValues = new Set<string>(
  trackerSourceOptions.flatMap((group) => ('children' in group ? group.children.map((c) => c.value) : [])),
)

const presetSources = computed({
  get: () => form.value.trackerSource.filter((v: string) => presetTrackerValues.has(v)),
  set: (vals: string[]) => {
    const custom = form.value.trackerSource.filter((v: string) => !presetTrackerValues.has(v))
    form.value.trackerSource = [...vals, ...custom]
  },
})

const customSelectOptions = computed(() =>
  form.value.customTrackerUrls.map((url: string) => ({ label: url, value: url })),
)

const customSources = computed({
  get: () => form.value.trackerSource.filter((v: string) => !presetTrackerValues.has(v)),
  set: (vals: string[]) => {
    const preset = form.value.trackerSource.filter((v: string) => presetTrackerValues.has(v))
    form.value.trackerSource = [...preset, ...vals]
  },
})

function onDeleteCustomTracker(url: string, e: Event) {
  e.stopPropagation()
  form.value.customTrackerUrls = form.value.customTrackerUrls.filter((v: string) => v !== url)
  customSources.value = customSources.value.filter((v: string) => v !== url)
}

function renderCustomOption(info: {
  node: VNodeChild
  option: { value?: string | number }
  selected: boolean
}): VNodeChild {
  const url = String(info.option.value ?? '')
  return h('div', { style: 'display:flex;align-items:center;position:relative;padding-right:32px' }, [
    h('div', { style: 'flex:1;min-width:0' }, [info.node]),
    h(
      'span',
      {
        style:
          'position:absolute;right:8px;display:flex;align-items:center;cursor:pointer;color:var(--error-color, #e88080)',
        onClick: (e: Event) => onDeleteCustomTracker(url, e),
      },
      [h(NIcon, { size: 18 }, { default: () => h(CloseCircleOutline) })],
    ),
  ])
}

function openTrackerSource(url: string) {
  openUrl(url).catch((e) => logger.error('BT.openTrackerSource', e))
}

const customPlaceholder = computed(() =>
  form.value.customTrackerUrls.length
    ? t('preferences.bt-tracker-source-custom-select')
    : t('preferences.bt-tracker-source-custom-empty'),
)

function buildForm() {
  const c = preferenceStore.config
  const formData = buildBtForm(c)
  if (!c.trackerSource) {
    formData.trackerSource = [...DEFAULT_TRACKER_SOURCE]
  }
  return formData
}

function buildSafeLimitContent(current: number) {
  return h('div', { style: 'display: flex; flex-direction: column; gap: 8px' }, [
    h(
      'div',
      { style: 'font-weight: 500' },
      `${t('preferences.bt-max-peers')}: ${current} (${t('preferences.recommended-limit', {
        value: SAFE_LIMIT_BT_MAX_PEERS,
      })})`,
    ),
    h('div', { style: 'opacity: 0.75' }, t('preferences.high-bt-peers-reason')),
  ])
}

function confirmBtPeerSafeLimit(f: Record<string, unknown>): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const revert = () => {
      f.btMaxPeers = SAFE_LIMIT_BT_MAX_PEERS
      resolve(false)
    }
    dialog.warning({
      title: t('preferences.safe-limit-warning-title'),
      content: () => buildSafeLimitContent(Number(f.btMaxPeers) || 0),
      positiveText: t('preferences.high-connection-continue'),
      negativeText: t('app.cancel'),
      onPositiveClick: () => resolve(true),
      onNegativeClick: revert,
      onClose: revert,
    })
  })
}

const { form, isDirty, handleSave, handleReset, resetSnapshot, patchSnapshot } = usePreferenceForm({
  buildForm,
  buildSystemConfig: buildBtSystemConfig,
  transformForStore: transformBtForStore,
  beforeSave: async (f) => {
    if (typeof f.btMaxPeers === 'number' && f.btMaxPeers > SAFE_LIMIT_BT_MAX_PEERS) {
      const ok = await confirmBtPeerSafeLimit(f)
      if (!ok) return false
    }

    const changed = diffConfig(preferenceStore.config, transformBtForStore(f))
    if (!checkIsNeedRestart(changed)) return true

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
    return true
  },
  afterSave: async () => {
    if (!needsRestart.value) return
    needsRestart.value = false
    const port = (preferenceStore.config.rpcListenPort as number) || ENGINE_RPC_PORT
    const secret = (preferenceStore.config.rpcSecret as string) || ''
    message.info(t('preferences.engine-restarting'))
    await nextTick()
    await new Promise((r) => requestAnimationFrame(r))
    await restartEngine({ port, secret })
  },
})

// ── Tracker sync ────────────────────────────────────────────────────
async function handleSyncTracker() {
  if (form.value.trackerSource.length === 0) {
    message.warning(t('preferences.bt-tracker-select-source'))
    return
  }
  syncingTracker.value = true
  try {
    const [result] = await Promise.all([
      preferenceStore.fetchBtTracker(form.value.trackerSource),
      new Promise((r) => setTimeout(r, SYNC_MIN_DURATION)),
    ])
    const text = convertTrackerDataToLine(result.data)
    if (result.failures.length === 0 && text) {
      await applySyncedTrackers(text, result.data)
      message.success(t('preferences.bt-tracker-sync-succeed'))
    } else if (result.data.length > 0 && text) {
      await applySyncedTrackers(text, result.data)
      showSyncFailureDialog(result.failures, result.data.length, form.value.trackerSource.length)
    } else {
      showSyncFailureDialog(result.failures, 0, form.value.trackerSource.length)
    }
  } catch (e) {
    logger.debug('BT.syncTracker', e)
    message.error(t('preferences.bt-tracker-sync-failed'))
  } finally {
    syncingTracker.value = false
  }
}

async function applySyncedTrackers(text: string, data: string[]) {
  const now = Date.now()
  const comma = convertTrackerDataToComma(data)
  const reduced = reduceTrackerString(comma)
  form.value.btTracker = text
  form.value.lastSyncTrackerTime = now
  await preferenceStore.updateAndSave({ btTracker: comma, lastSyncTrackerTime: now })
  patchSnapshot({ btTracker: text, lastSyncTrackerTime: now } as Partial<typeof form.value>)
  await invoke('save_system_config', { config: { 'bt-tracker': reduced } })
  if (isEngineReady()) {
    await changeGlobalOption({ 'bt-tracker': reduced } as Partial<typeof preferenceStore.config>)
  }
}

function showSyncFailureDialog(
  failures: Array<{ url: string; reason: string }>,
  successCount: number,
  totalCount: number,
) {
  const isPartial = successCount > 0
  const dialogType = isPartial ? 'warning' : 'error'
  const title = isPartial ? t('preferences.bt-tracker-sync-partial-title') : t('preferences.bt-tracker-sync-failed')
  dialog[dialogType]({
    title,
    content: () =>
      h('div', { style: 'max-height:300px;overflow-y:auto' }, [
        isPartial
          ? h(
              'p',
              { style: 'margin:0 0 8px;color:var(--text-color-secondary, #999)' },
              `${successCount}/${totalCount} ${t('preferences.bt-tracker-sync-sources-ok')}`,
            )
          : null,
        h('p', { style: 'margin:0 0 8px;font-weight:500' }, t('preferences.bt-tracker-sync-failed-sources')),
        ...failures.map((f) =>
          h(
            'div',
            {
              style:
                'margin:6px 0;padding:6px 8px;border-radius:4px;background:var(--error-color-hover, rgba(232,128,128,0.08))',
            },
            [
              h('div', { style: 'font-size:12px;word-break:break-all;font-weight:500' }, f.url),
              h('div', { style: 'font-size:11px;color:var(--error-color, #e88080);margin-top:2px' }, f.reason),
            ],
          ),
        ),
      ]),
    positiveText: 'OK',
  })
}

function onAddCustomTracker() {
  const url = customTrackerInput.value.trim()
  if (!url) return
  if (!isValidTrackerSourceUrl(url)) {
    message.warning(t('preferences.bt-tracker-source-invalid-url'))
    return
  }
  if (!form.value.customTrackerUrls.includes(url)) {
    form.value.customTrackerUrls = [...form.value.customTrackerUrls, url]
  }
  if (!form.value.trackerSource.includes(url)) {
    form.value.trackerSource = [...form.value.trackerSource, url]
  }
  customTrackerInput.value = ''
}

const { restartEngine } = useEngineRestart()
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
      <!-- BT Settings -->
      <NDivider title-placement="left">{{ t('preferences.bt-settings') }}</NDivider>

      <NFormItem :label="t('preferences.bt-auto-download-content')">
        <NSwitch v-model:value="form.btAutoDownloadContent" />
      </NFormItem>
      <NFormItem :label="t('preferences.bt-force-encryption')">
        <NSwitch v-model:value="form.btForceEncryption" />
      </NFormItem>
      <NFormItem :label="t('preferences.bt-max-peers')">
        <NInputNumber v-model:value="form.btMaxPeers" :min="0" :max="ENGINE_MAX_BT_MAX_PEERS" class="pref-number" />
      </NFormItem>

      <NDivider title-placement="left">{{ t('preferences.bt-discovery-section') }}</NDivider>
      <NFormItem :label="t('preferences.bt-peer-exchange')">
        <NSwitch v-model:value="form.btPeerExchangeEnabled" />
      </NFormItem>
      <NFormItem :label="t('preferences.bt-local-peer-discovery')">
        <NSwitch v-model:value="form.btLocalPeerDiscoveryEnabled" />
      </NFormItem>
      <NFormItem :label="t('preferences.bt-dht-network')">
        <PreferenceCheckboxGrid v-model:value="selectedDhtNetworks" :options="dhtNetworkOptions" />
      </NFormItem>

      <!-- Tracker Management -->
      <NDivider title-placement="left">{{ t('preferences.bt-tracker') }}</NDivider>
      <NFormItem :label="t('preferences.bt-tracker-source-preset')">
        <NSelect
          v-model:value="presetSources"
          :options="trackerSourceOptions"
          multiple
          :placeholder="t('preferences.bt-tracker-source-placeholder')"
          clearable
          max-tag-count="responsive"
        />
      </NFormItem>
      <NFormItem :label="t('preferences.bt-tracker-source-custom')">
        <NInputGroup>
          <NInput
            v-model:value="customTrackerInput"
            :placeholder="t('preferences.bt-tracker-source-custom-placeholder')"
            clearable
            class="pref-control-full"
            @keydown.enter="onAddCustomTracker"
          />
          <NButton size="small" class="pref-input-group-action" @click="onAddCustomTracker">
            <template #icon>
              <NIcon><AddCircleOutline /></NIcon>
            </template>
          </NButton>
        </NInputGroup>
      </NFormItem>
      <NFormItem label=" ">
        <NSelect
          v-model:value="customSources"
          :options="customSelectOptions"
          :render-option="renderCustomOption"
          multiple
          clearable
          :placeholder="customPlaceholder"
          max-tag-count="responsive"
        />
      </NFormItem>
      <NFormItem label=" ">
        <div class="pref-inline-row">
          <NButton
            class="pref-action-button bt-tracker-sync-button"
            :loading="syncingTracker"
            type="primary"
            secondary
            @click="handleSyncTracker"
          >
            <template #icon>
              <NIcon><SyncOutline /></NIcon>
            </template>
            {{ t('preferences.bt-tracker-sync') }}
          </NButton>
          <span class="pref-inline-row__meta">
            {{ t('preferences.last-sync-time') }}
            {{ form.lastSyncTrackerTime ? new Date(form.lastSyncTrackerTime as number).toLocaleString() : '—' }}
          </span>
        </div>
      </NFormItem>
      <NFormItem :label="t('preferences.bt-tracker-content')">
        <NInput
          v-model:value="form.btTracker"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 8 }"
          :placeholder="t('preferences.bt-tracker-input-tips')"
        />
      </NFormItem>
      <NFormItem :show-label="false">
        <div class="info-text">
          {{ t('preferences.bt-tracker-tips') }}
          <button class="info-link" type="button" @click="openTrackerSource('https://github.com/ngosang/trackerslist')">
            ngosang/trackerslist ↗
          </button>
          <button
            class="info-link pref-meta-link"
            type="button"
            @click="openTrackerSource('https://github.com/XIU2/TrackersListCollection')"
          >
            XIU2/TrackersListCollection ↗
          </button>
        </div>
      </NFormItem>
      <NFormItem :label="t('preferences.auto-sync')">
        <NSwitch v-model:value="form.btTrackerAutoSync" />
      </NFormItem>
      <NFormItem v-if="form.btTrackerAutoSync" :label="t('preferences.sync-frequency')">
        <NSelect
          v-model:value="form.btTrackerSyncIntervalHours"
          :options="syncIntervalOptions"
          class="pref-control-auto"
        />
      </NFormItem>
    </NForm>
    <PreferenceActionBar :is-dirty="isDirty" @save="handleSave" @discard="handleReset" @restart="handleManualRestart" />
  </div>
</template>

<style scoped>
.bt-tracker-sync-button {
  min-width: 100px;
}

.info-text {
  color: var(--m3-on-surface-variant);
  font-size: 12px;
  max-width: 520px;
  word-wrap: break-word;
}
.info-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  text-decoration: none;
  font-size: 12px;
}
.info-link:hover {
  text-decoration: underline;
}
.info-text .pref-meta-link {
  margin-left: 18px;
}
</style>
