/**
 * Axios HTTP client for the Motrix Next web API.
 *
 * The base URL defaults to the same origin so that the Vite dev server
 * proxy works out of the box.  In production the frontend is served
 * by the Rust web server at the same origin.
 *
 * Includes automatic retry with exponential backoff for transient
 * failures (network errors, 5xx, 429) to improve robustness during
 * development and production.
 */
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

/** Maximum retry attempts per request. */
const MAX_RETRIES = 3
/** Initial backoff delay in milliseconds. */
const BASE_DELAY_MS = 1000
/** Status codes that are safe to retry. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

interface RetryConfig extends InternalAxiosRequestConfig {
  _retryCount?: number
}

const httpClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined
    if (!config) {
      return Promise.reject(error)
    }

    const retryCount = config._retryCount ?? 0
    const status = error.response?.status

    // Only retry on network errors or retryable status codes
    const isNetworkError = !error.response && error.code !== 'ECONNABORTED'
    const isRetryableStatus = status !== undefined && RETRYABLE_STATUSES.has(status)

    if ((isNetworkError || isRetryableStatus) && retryCount < MAX_RETRIES) {
      config._retryCount = retryCount + 1
      const delay = BASE_DELAY_MS * Math.pow(2, retryCount)
      await new Promise((resolve) => setTimeout(resolve, delay))
      return httpClient.request(config)
    }

    // Format error message for consistent error reporting
    if (error.response) {
      const { data } = error.response
      const message = typeof data === 'string' ? data : JSON.stringify(data)
      return Promise.reject(new Error(`[HTTP ${status}] ${message}`))
    }
    if (error.request) {
      return Promise.reject(new Error('Network error — server unreachable'))
    }
    return Promise.reject(error)
  },
)

export default httpClient
