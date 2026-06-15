/**
 * Browser-compatible mock for @tauri-apps/api/event.
 *
 * `listen()` returns a no-op unlisten function.
 * `emit()` dispatches a CustomEvent on `window` so frontend event-based
 * logic continues to work across components.
 */

export type UnlistenFn = () => void

export interface Event<T> {
  event: string
  id: number
  payload: T
}

export async function listen<T>(_event: string, _handler: (event: Event<T>) => void): Promise<UnlistenFn> {
  return () => {}
}

export async function once<T>(_event: string, _handler: (event: Event<T>) => void): Promise<UnlistenFn> {
  return () => {}
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  window.dispatchEvent(new CustomEvent(event, { detail: payload }))
}
