/**
 * @fileoverview Tests for useNetworkPreference pure functions.
 *
 * The Network tab manages proxy, port mapping, transfer parameters (timeouts,
 * file allocation), and User-Agent. All keys here map to aria2 engine options
 * via buildNetworkSystemConfig.
 *
 * Proxy validation logic (isValidAria2ProxyUrl, validateNetworkForm) and
 * port randomizers (randomBtPort, randomDhtPort) are also covered here.
 */
import { describe, it, expect } from 'vitest'
import {
  buildNetworkForm,
  buildNetworkSystemConfig,
  transformNetworkForStore,
  validateNetworkForm,
  isValidAria2ProxyUrl,
  randomBtPort,
  randomDhtPort,
  type NetworkForm,
} from '../useNetworkPreference'
import { PROXY_SCOPES, PROXY_SCOPE_OPTIONS, DEFAULT_APP_CONFIG } from '@shared/constants'
import type { AppConfig } from '@shared/types'

// ── isValidAria2ProxyUrl ────────────────────────────────────────────

describe('isValidAria2ProxyUrl', () => {
  // ── Valid inputs ──────────────────────────────────────────────────

  it('accepts empty string (clears proxy)', () => {
    expect(isValidAria2ProxyUrl('')).toBe(true)
  })

  it('accepts whitespace-only string', () => {
    expect(isValidAria2ProxyUrl('   ')).toBe(true)
  })

  it('accepts http:// proxy', () => {
    expect(isValidAria2ProxyUrl('http://127.0.0.1:8080')).toBe(true)
  })

  it('accepts https:// proxy', () => {
    expect(isValidAria2ProxyUrl('https://proxy.example.com:443')).toBe(true)
  })

  it('accepts ftp:// proxy', () => {
    expect(isValidAria2ProxyUrl('ftp://proxy.example.com:21')).toBe(true)
  })

  it('accepts http:// with user:password', () => {
    expect(isValidAria2ProxyUrl('http://user:pass@proxy.example.com:8080')).toBe(true)
  })

  it('accepts bare HOST:PORT (no scheme)', () => {
    expect(isValidAria2ProxyUrl('127.0.0.1:8080')).toBe(true)
  })

  it('accepts bare hostname (no port, no scheme)', () => {
    expect(isValidAria2ProxyUrl('proxy.example.com')).toBe(true)
  })

  it('accepts URL with leading/trailing whitespace', () => {
    expect(isValidAria2ProxyUrl('  http://proxy:8080  ')).toBe(true)
  })

  // ── Rejected inputs ───────────────────────────────────────────────

  it('rejects socks5:// proxy', () => {
    expect(isValidAria2ProxyUrl('socks5://127.0.0.1:1080')).toBe(false)
  })

  it('rejects socks4:// proxy', () => {
    expect(isValidAria2ProxyUrl('socks4://127.0.0.1:1080')).toBe(false)
  })

  it('rejects socks5h:// proxy', () => {
    expect(isValidAria2ProxyUrl('socks5h://127.0.0.1:1080')).toBe(false)
  })

  it('rejects socks4a:// proxy', () => {
    expect(isValidAria2ProxyUrl('socks4a://127.0.0.1:1080')).toBe(false)
  })

  it('rejects SOCKS5:// (case-insensitive)', () => {
    expect(isValidAria2ProxyUrl('SOCKS5://127.0.0.1:1080')).toBe(false)
  })

  it('rejects ws:// scheme', () => {
    expect(isValidAria2ProxyUrl('ws://proxy:8080')).toBe(false)
  })

  it('rejects custom:// scheme', () => {
    expect(isValidAria2ProxyUrl('custom://proxy:8080')).toBe(false)
  })
})

// ── buildNetworkForm ────────────────────────────────────────────────

describe('buildNetworkForm', () => {
  const emptyConfig = {} as AppConfig

  // ── Proxy ───────────────────────────────────────────────────────

  it('defaults proxy mode to environment inheritance', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.proxy.mode).toBe('auto')
  })

  it('defaults proxy.server to empty string', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.proxy.server).toBe('')
  })

  it('default scope includes ALL scopes so proxy works on first enable', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.proxy.scope).toEqual(expect.arrayContaining([PROXY_SCOPES.DOWNLOAD]))
    expect(form.proxy.scope).toHaveLength(PROXY_SCOPE_OPTIONS.length)
  })

  it('preserves proxy configuration from config', () => {
    const config = {
      proxy: { mode: 'manual', enable: true, server: 'http://127.0.0.1:7890', bypass: '*.local', scope: ['download'] },
    } as AppConfig
    const form = buildNetworkForm(config)
    expect(form.proxy.enable).toBe(true)
    expect(form.proxy.server).toBe('http://127.0.0.1:7890')
    expect(form.proxy.bypass).toBe('*.local')
    expect(form.proxy.scope).toEqual(['download'])
  })

  it('preserves user-selected subset of scopes', () => {
    const config = {
      proxy: {
        mode: 'manual',
        enable: true,
        server: 'http://127.0.0.1:7890',
        bypass: '',
        scope: [PROXY_SCOPES.DOWNLOAD],
      },
    } as AppConfig
    const form = buildNetworkForm(config)
    expect(form.proxy.scope).toEqual([PROXY_SCOPES.DOWNLOAD])
  })

  // ── Ports ───────────────────────────────────────────────────────

  it('defaults enableUpnp to true', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.enableUpnp).toBe(true)
  })

  it('handles enableUpnp=false explicitly', () => {
    const config = { enableUpnp: false } as unknown as AppConfig
    const form = buildNetworkForm(config)
    expect(form.enableUpnp).toBe(false)
  })

  it('defaults listenPort to 29120', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.listenPort).toBe(29120)
  })

  it('defaults dhtListenPort to 29130', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.dhtListenPort).toBe(29130)
  })

  it('coerces string port values to numbers', () => {
    const config = { listenPort: '12345' as unknown, dhtListenPort: '54321' as unknown } as AppConfig
    const form = buildNetworkForm(config)
    expect(form.listenPort).toBe(12345)
    expect(form.dhtListenPort).toBe(54321)
  })

  // ── Transfer Parameters ─────────────────────────────────────────

  it('defaults connectTimeout to 10', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.connectTimeout).toBe(10)
  })

  it('reads connectTimeout from config', () => {
    const config = { connectTimeout: 30 } as unknown as AppConfig
    const form = buildNetworkForm(config)
    expect(form.connectTimeout).toBe(30)
  })

  it('defaults timeout to 10', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.timeout).toBe(10)
  })

  it('reads timeout from config', () => {
    const config = { timeout: 60 } as unknown as AppConfig
    const form = buildNetworkForm(config)
    expect(form.timeout).toBe(60)
  })

  it('defaults fileAllocation to prealloc', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.fileAllocation).toBe('prealloc')
  })

  it('reads fileAllocation from config', () => {
    const config = { fileAllocation: 'prealloc' } as unknown as AppConfig
    const form = buildNetworkForm(config)
    expect(form.fileAllocation).toBe('prealloc')
  })

  // ── User-Agent ──────────────────────────────────────────────────

  it('defaults userAgent from DEFAULT_APP_CONFIG', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.userAgent).toBe(DEFAULT_APP_CONFIG.userAgent)
  })

  it('reads userAgent from config', () => {
    const config = { userAgent: 'Mozilla/5.0 Custom' } as AppConfig
    const form = buildNetworkForm(config)
    expect(form.userAgent).toBe('Mozilla/5.0 Custom')
  })

  // ── Completeness ────────────────────────────────────────────────

  it('returns all expected form fields', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form).toHaveProperty('proxy')
    expect(form).toHaveProperty('enableUpnp')
    expect(form).toHaveProperty('autoChangeConflictingPorts')
    expect(form).toHaveProperty('portConflictRecovery')
    expect(form).toHaveProperty('listenPort')
    expect(form).toHaveProperty('dhtListenPort')
    expect(form).toHaveProperty('connectTimeout')
    expect(form).toHaveProperty('timeout')
    expect(form).toHaveProperty('fileAllocation')
    expect(form).toHaveProperty('userAgent')
  })

  it('defaults port conflict recovery to enabled for every managed port type', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.portConflictRecovery).toEqual({
      enabled: true,
      rangeStart: 29000,
      rangeEnd: 29999,
      rpc: true,
      extensionApi: true,
      bt: true,
      dht: true,
      ed2k: true,
      ed2kUdp: true,
    })
  })

  it('uses the legacy auto switch value when no recovery policy exists', () => {
    const form = buildNetworkForm({ autoChangeConflictingPorts: false } as AppConfig)
    expect(form.portConflictRecovery.enabled).toBe(false)
  })
})

// ── buildNetworkSystemConfig ────────────────────────────────────────

describe('buildNetworkSystemConfig', () => {
  const baseForm: NetworkForm = {
    proxy: { mode: 'direct', enable: false, server: '', bypass: '', scope: [] },
    enableUpnp: true,
    autoChangeConflictingPorts: true,
    portConflictRecovery: { ...DEFAULT_APP_CONFIG.portConflictRecovery },
    listenPort: 29120,
    dhtListenPort: 29130,
    connectTimeout: 10,
    timeout: 10,
    fileAllocation: 'none',
    userAgent: '',
  }

  it('maps port and protocol keys to aria2 config', () => {
    const config = buildNetworkSystemConfig(baseForm)
    expect(config['listen-port']).toBe('29120')
    expect(config['dht-listen-port']).toBe('29130')
    expect(config).not.toHaveProperty('enable-dht')
    expect(config).not.toHaveProperty('enable-peer-exchange')
  })

  it('maps transfer parameter keys to aria2 config', () => {
    const config = buildNetworkSystemConfig(baseForm)
    expect(config['connect-timeout']).toBe('10')
    expect(config['timeout']).toBe('10')
    expect(config['file-allocation']).toBe('none')
  })

  it('emits custom connect-timeout and timeout values', () => {
    const config = buildNetworkSystemConfig({ ...baseForm, connectTimeout: 30, timeout: 60 })
    expect(config['connect-timeout']).toBe('30')
    expect(config['timeout']).toBe('60')
  })

  it('emits custom file-allocation value', () => {
    const config = buildNetworkSystemConfig({ ...baseForm, fileAllocation: 'prealloc' })
    expect(config['file-allocation']).toBe('prealloc')
  })

  it('falls back empty file-allocation to prealloc', () => {
    const config = buildNetworkSystemConfig({ ...baseForm, fileAllocation: '' })
    expect(config['file-allocation']).toBe('prealloc')
  })

  it('maps user-agent to aria2 config', () => {
    const config = buildNetworkSystemConfig({ ...baseForm, userAgent: 'Custom/1.0' })
    expect(config['user-agent']).toBe('Custom/1.0')
  })

  // ── Proxy flow ──────────────────────────────────────────────────

  it('sets manual proxy mode when enabled for downloads', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: {
        mode: 'manual',
        enable: true,
        server: 'http://proxy:8080',
        bypass: '*.local',
        scope: [PROXY_SCOPES.DOWNLOAD],
      },
    })
    expect(config['proxy-mode']).toBe('manual')
    expect(config['all-proxy']).toBe('http://proxy:8080')
    expect(config['no-proxy']).toBe('*.local')
  })

  it('forces direct mode when download scope is excluded', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: { mode: 'manual', enable: true, server: 'http://proxy:8080', bypass: '*.local', scope: ['app'] },
    })
    expect(config['proxy-mode']).toBe('direct')
    expect(config['all-proxy']).toBeUndefined()
    expect(config['no-proxy']).toBeUndefined()
  })

  it('forces direct mode when proxy is direct', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: { mode: 'direct', enable: false, server: 'http://proxy:8080', bypass: '', scope: [PROXY_SCOPES.DOWNLOAD] },
    })
    expect(config['proxy-mode']).toBe('direct')
    expect(config['all-proxy']).toBeUndefined()
  })

  it('manual mode with default scope produces non-empty all-proxy', () => {
    const form = buildNetworkForm({} as AppConfig)
    form.proxy.mode = 'manual'
    form.proxy.server = 'http://127.0.0.1:7890'
    const config = buildNetworkSystemConfig(form)
    expect(config['proxy-mode']).toBe('manual')
    expect(config['all-proxy']).toBe('http://127.0.0.1:7890')
    expect(config['no-proxy']).toBeUndefined()
  })

  it('auto mode emits only proxy-mode', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: {
        mode: 'auto',
        enable: false,
        server: 'http://127.0.0.1:7890',
        bypass: '',
        scope: [PROXY_SCOPES.DOWNLOAD],
      },
    })
    expect(config['proxy-mode']).toBe('auto')
    expect(config['all-proxy']).toBeUndefined()
  })

  it('proxy bypass value is forwarded to no-proxy when download scope active', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: {
        mode: 'manual',
        enable: true,
        server: 'http://proxy:8080',
        bypass: '192.168.0.0/16,*.local',
        scope: [PROXY_SCOPES.DOWNLOAD],
      },
    })
    expect(config['all-proxy']).toBe('http://proxy:8080')
    expect(config['no-proxy']).toBe('192.168.0.0/16,*.local')
  })
})

// ── transformNetworkForStore ────────────────────────────────────────

describe('transformNetworkForStore', () => {
  const baseForm: NetworkForm = {
    proxy: { mode: 'direct', enable: false, server: '', bypass: '', scope: [] },
    enableUpnp: true,
    autoChangeConflictingPorts: true,
    portConflictRecovery: { ...DEFAULT_APP_CONFIG.portConflictRecovery },
    listenPort: 29120,
    dhtListenPort: 29130,
    connectTimeout: 10,
    timeout: 10,
    fileAllocation: 'none',
    userAgent: '',
  }

  it('preserves port numbers as numbers (not strings)', () => {
    const result = transformNetworkForStore(baseForm)
    expect(result.listenPort).toBe(29120)
    expect(typeof result.listenPort).toBe('number')
    expect(result.dhtListenPort).toBe(29130)
    expect(typeof result.dhtListenPort).toBe('number')
  })

  it('preserves automatic conflicting port switching preference', () => {
    const result = transformNetworkForStore({
      ...baseForm,
      portConflictRecovery: { ...baseForm.portConflictRecovery, enabled: false },
    })
    expect(result.autoChangeConflictingPorts).toBe(false)
    expect(result.portConflictRecovery).toMatchObject({ enabled: false })
  })

  it('preserves proxy config through transform', () => {
    const result = transformNetworkForStore({
      ...baseForm,
      proxy: { mode: 'manual', enable: true, server: 'http://127.0.0.1:7890', bypass: '*.local', scope: ['download'] },
    })
    expect(result.proxy).toEqual({
      mode: 'manual',
      enable: true,
      server: 'http://127.0.0.1:7890',
      bypass: '*.local',
      scope: ['download'],
    })
  })

  it('preserves timeout values through transform', () => {
    const result = transformNetworkForStore({ ...baseForm, connectTimeout: 30, timeout: 60 })
    expect(result.connectTimeout).toBe(30)
    expect(result.timeout).toBe(60)
  })

  it('preserves fileAllocation through transform', () => {
    const result = transformNetworkForStore({ ...baseForm, fileAllocation: 'prealloc' })
    expect(result.fileAllocation).toBe('prealloc')
  })
})

// ── validateNetworkForm ─────────────────────────────────────────────

describe('validateNetworkForm', () => {
  const validForm: NetworkForm = {
    proxy: { mode: 'direct', enable: false, server: '', bypass: '', scope: [] },
    enableUpnp: true,
    autoChangeConflictingPorts: true,
    portConflictRecovery: { ...DEFAULT_APP_CONFIG.portConflictRecovery },
    listenPort: 29120,
    dhtListenPort: 29130,
    connectTimeout: 10,
    timeout: 10,
    fileAllocation: 'none',
    userAgent: '',
  }

  it('returns null for valid form', () => {
    expect(validateNetworkForm(validForm)).toBeNull()
  })

  it('rejects invalid port recovery ranges', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        portConflictRecovery: { ...validForm.portConflictRecovery, rangeStart: 25000, rangeEnd: 23999 },
      }),
    ).toBe('preferences.port-conflict-recovery-invalid-range')
  })

  it('ignores invalid hidden port recovery ranges when recovery is disabled', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        portConflictRecovery: {
          ...validForm.portConflictRecovery,
          enabled: false,
          rangeStart: 25000,
          rangeEnd: 23999,
        },
      }),
    ).toBeNull()
  })

  it('returns null for valid proxy URL in manual mode', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        proxy: { ...validForm.proxy, mode: 'manual', enable: true, server: 'http://proxy.example.com:8080' },
      }),
    ).toBeNull()
  })

  it('returns invalid-proxy-url for malformed URL in manual mode', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        proxy: { ...validForm.proxy, mode: 'manual', enable: true, server: 'http://:invalid:url:' },
      }),
    ).toBe('preferences.invalid-proxy-url')
  })

  it('returns proxy-unsupported-protocol for socks5 in manual mode', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        proxy: { ...validForm.proxy, mode: 'manual', enable: true, server: 'socks5://127.0.0.1:1080' },
      }),
    ).toBe('preferences.proxy-unsupported-protocol')
  })

  it('returns null for invalid proxy URL in direct mode', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        proxy: { ...validForm.proxy, mode: 'direct', enable: false, server: 'socks5://127.0.0.1:1080' },
      }),
    ).toBeNull()
  })

  it('returns null for empty proxy server in manual mode', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        proxy: { ...validForm.proxy, mode: 'manual', enable: true, server: '' },
      }),
    ).toBeNull()
  })
})

// ── Port Randomizers ────────────────────────────────────────────────

describe('port randomizers', () => {
  it('randomBtPort stays within the port recovery range', () => {
    for (let i = 0; i < 20; i++) {
      const port = randomBtPort()
      expect(port).toBeGreaterThanOrEqual(29000)
      expect(port).toBeLessThanOrEqual(29999)
    }
  })

  it('randomDhtPort stays within the port recovery range', () => {
    for (let i = 0; i < 20; i++) {
      const port = randomDhtPort()
      expect(port).toBeGreaterThanOrEqual(29000)
      expect(port).toBeLessThanOrEqual(29999)
    }
  })
})
