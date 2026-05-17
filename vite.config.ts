import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Capture the current git SHA at build time so the running app can display it.
function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_SHA__: JSON.stringify(getGitSha()),
  },
  server: {
    headers: {
      // COOP/COEP required for SharedArrayBuffer (multi-threaded WASM in later phases).
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
