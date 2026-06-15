/**
 * @fileoverview SSE (Server-Sent Events) connection manager for web mode.
 *
 * Maintains a single EventSource connection to the backend, dispatching
 * events to registered listeners. Handles reconnection automatically.
 */

import { logger } from '@shared/logger'

/** Stat update payload matching the Rust `StatUpdate` struct. */
export interface StatUpdatePayload {
  downloadSpeed: number
  uploadSpeed: number
  numActive: number
  numWaiting: number
  numStopped: number
  numStoppedTotal: number
}

/** All SSE event types received from the backend. */
export interface SseEventMap {
  'stat:update': StatUpdatePayload
  'task:changed': null
}

type EventHandlerMap = Record<string, Set<(payload: unknown) => void>>

type ConnectionChangeHandler = (connected: boolean) => void

/** Base URL for the SSE endpoint (no trailing slash). */
function sseUrl(): string {
  // In dev mode, Vite proxies /api to the backend
  return '/api/events'
}

class SseConnection {
  private source: EventSource | null = null
  private handlers: Partial<EventHandlerMap> = {}
  private connectionListeners = new Set<ConnectionChangeHandler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private reconnectDelay = 1000

  /** Start the SSE connection. Idempotent — safe to call multiple times. */
  start(): void {
    if (this.source) return
    this.stopped = false
    this.connect()
  }

  /** Stop the SSE connection. */
  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.source) {
      this.source.close()
      this.source = null
    }
  }

  /** Register a handler for a specific event type. */
  on<K extends keyof SseEventMap>(type: K, handler: (payload: SseEventMap[K]) => void): () => void {
    if (!this.handlers[type]) {
      this.handlers[type] = new Set()
    }
    ;(this.handlers[type] as Set<(payload: unknown) => void>).add(handler as (payload: unknown) => void)
    return () => {
      ;(this.handlers[type] as Set<(payload: unknown) => void> | undefined)?.delete(
        handler as (payload: unknown) => void,
      )
    }
  }

  /** Register a handler that fires on connection/disconnection. */
  onConnectionChange(handler: ConnectionChangeHandler): () => void {
    this.connectionListeners.add(handler)
    return () => {
      this.connectionListeners.delete(handler)
    }
  }

  private connect(): void {
    if (this.stopped) return

    try {
      this.source = new EventSource(sseUrl())

      this.source.onopen = () => {
        logger.debug('SSE', 'connected')
        this.reconnectDelay = 1000
        this.notifyConnectionChange(true)
      }

      this.source.onerror = () => {
        logger.debug('SSE', 'connection error')
        this.notifyConnectionChange(false)
        // EventSource auto-reconnects after close/error, but we also
        // use manual reconnect with backoff to handle edge cases
        this.source?.close()
        this.source = null
        this.scheduleReconnect()
      }

      // Register message handlers for known event types
      const eventTypes: (keyof SseEventMap)[] = ['stat:update', 'task:changed']
      for (const type of eventTypes) {
        this.source.addEventListener(type, (event: MessageEvent) => {
          try {
            const parsed = JSON.parse(event.data)
            // The backend sends { type: "...", payload: ... }
            this.dispatch(type, parsed.payload ?? null)
          } catch {
            logger.debug('SSE', `failed to parse ${type}`)
          }
        })
      }
    } catch {
      // EventSource constructor can throw in some environments
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return

    logger.debug('SSE', `reconnecting in ${this.reconnectDelay}ms`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
      this.connect()
    }, this.reconnectDelay)
  }

  private dispatch<K extends keyof SseEventMap>(type: K, payload: SseEventMap[K]): void {
    ;(this.handlers[type] as Set<(payload: unknown) => void> | undefined)?.forEach((h) => {
      try {
        h(payload)
      } catch (e) {
        logger.warn('SSE', `handler error for ${type}: ${e}`)
      }
    })
  }

  private notifyConnectionChange(connected: boolean): void {
    this.connectionListeners.forEach((h) => {
      try {
        h(connected)
      } catch {
        // ignore handler errors
      }
    })
  }
}

export const sseConnection = new SseConnection()
