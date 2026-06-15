import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import { resolve } from 'path'

const host = process.env.TAURI_DEV_HOST
const isWebMode = process.env.VITE_WEB_MODE === '1' || process.env.VITE_WEB_MODE === 'true'

const TAURI_MOCK_ALIASES: Record<string, string> = {
  '@tauri-apps/api/core': resolve(__dirname, 'src/mock/tauri-api-core.ts'),
  '@tauri-apps/api/event': resolve(__dirname, 'src/mock/tauri-api-event.ts'),
  '@tauri-apps/api/window': resolve(__dirname, 'src/mock/tauri-api-window.ts'),
  '@tauri-apps/api/webview': resolve(__dirname, 'src/mock/tauri-api-webview.ts'),
  '@tauri-apps/api/path': resolve(__dirname, 'src/mock/tauri-api-path.ts'),
  '@tauri-apps/api/app': resolve(__dirname, 'src/mock/tauri-api-app.ts'),
  '@tauri-apps/plugin-store': resolve(__dirname, 'src/mock/tauri-plugin-store.ts'),
  '@tauri-apps/plugin-log': resolve(__dirname, 'src/mock/tauri-plugin-log.ts'),
  '@tauri-apps/plugin-os': resolve(__dirname, 'src/mock/tauri-plugin-os.ts'),
  '@tauri-apps/plugin-fs': resolve(__dirname, 'src/mock/tauri-plugin-fs.ts'),
  '@tauri-apps/plugin-dialog': resolve(__dirname, 'src/mock/tauri-plugin-dialog.ts'),
  '@tauri-apps/plugin-shell': resolve(__dirname, 'src/mock/tauri-plugin-shell.ts'),
  '@tauri-apps/plugin-clipboard-manager': resolve(__dirname, 'src/mock/tauri-plugin-clipboard-manager.ts'),
  '@tauri-apps/plugin-opener': resolve(__dirname, 'src/mock/tauri-plugin-opener.ts'),
  '@tauri-apps/plugin-process': resolve(__dirname, 'src/mock/tauri-plugin-process.ts'),
  '@tauri-apps/plugin-autostart': resolve(__dirname, 'src/mock/tauri-plugin-autostart.ts'),
  '@tauri-apps/plugin-sql': resolve(__dirname, 'src/mock/tauri-plugin-sql.ts'),
  '@tauri-apps/plugin-updater': resolve(__dirname, 'src/mock/tauri-plugin-updater.ts'),
  '@tauri-apps/plugin-deep-link': resolve(__dirname, 'src/mock/tauri-plugin-deep-link.ts'),
  '@tauri-apps/plugin-notification': resolve(__dirname, 'src/mock/tauri-plugin-notification.ts'),
  'tauri-plugin-locale-api': resolve(__dirname, 'src/mock/tauri-plugin-locale-api.ts'),
}

export default defineConfig(() => {
  const resolveAlias: Record<string, string> = {
    '@': resolve(__dirname, 'src'),
    '@shared': resolve(__dirname, 'src/shared'),
    path: 'path-browserify',
  }

  if (isWebMode) {
    Object.assign(resolveAlias, TAURI_MOCK_ALIASES)
  }

  const define: Record<string, string | boolean> = {}
  if (isWebMode) {
    define['__TAURI__'] = false
    define['__TAURI_INTERNALS__'] = '{}'
  }

  const chunks: Record<string, string[]> = {
    'naive-ui': ['naive-ui'],
    'vue-vendor': ['vue', 'vue-router', 'pinia', 'vue-i18n'],
  }

  if (!isWebMode) {
    chunks['tauri-api'] = [
      '@tauri-apps/api',
      '@tauri-apps/plugin-shell',
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-clipboard-manager',
      '@tauri-apps/plugin-updater',
    ]
  }

  return {
    plugins: [
      vue(),
      UnoCSS(),
      VueI18nPlugin({
        include: resolve(__dirname, 'src/shared/locales/**'),
        runtimeOnly: true,
      }),
    ],
    resolve: {
      alias: resolveAlias,
    },
    define,
    clearScreen: false,
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
        },
        output: {
          manualChunks: chunks,
        },
      },
    },
    server: isWebMode
      ? {
          port: 5173,
          strictPort: false,
          host: '0.0.0.0',
          proxy: {
            '/api': {
              target: 'http://127.0.0.1:22077',
              changeOrigin: true,
            },
          },
        }
      : {
          port: 1420,
          strictPort: true,
          host: host || false,
          hmr: host
            ? {
                protocol: 'ws',
                host,
                port: 1421,
              }
            : undefined,
          watch: {
            ignored: ['**/src-tauri/**'],
          },
        },
  }
})