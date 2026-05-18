import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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

/**
 * Copy onnxruntime-web's wasm/mjs runtime files from node_modules into
 * `public/ort/` so they are served by Vite at `/ort/<file>`. The worker
 * configures `ort.env.wasm.wasmPaths = '/ort/'` so ort can locate them at
 * runtime regardless of code-splitting / module-worker URL rewriting.
 *
 * Without this copy, ort's internal bootstrap tries to resolve wasm via the
 * importing module's URL, which in a Vite-bundled worker context resolves to
 * `/@fs/...` or hashed asset URLs that don't match the wasm files' actual
 * locations — manifesting as "Cannot read properties of undefined (reading
 * 'registerBackend')" when the backend module fails to load.
 *
 * Files are copied at `buildStart` (both dev + build). The copy is idempotent
 * and only writes when the source is newer than the destination.
 */
function copyOrtWasmPlugin(): Plugin {
  return {
    name: 'copy-ort-wasm',
    buildStart() {
      const src = resolve(__dirname, 'node_modules/onnxruntime-web/dist')
      const dst = resolve(__dirname, 'public/ort')
      if (!existsSync(src)) return
      if (!existsSync(dst)) mkdirSync(dst, { recursive: true })
      for (const name of readdirSync(src)) {
        // Ship only the files ort's bootstrap actually fetches at runtime:
        // the wasm binaries and their accompanying glue .mjs loaders.
        if (!/\.(wasm|mjs)$/.test(name)) continue
        if (name.endsWith('.map')) continue
        const srcPath = join(src, name)
        const dstPath = join(dst, name)
        try {
          const srcMtime = statSync(srcPath).mtimeMs
          const dstMtime = existsSync(dstPath) ? statSync(dstPath).mtimeMs : 0
          if (srcMtime > dstMtime) copyFileSync(srcPath, dstPath)
        } catch {
          // best-effort: a missing/locked file should not fail the build
        }
      }
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), copyOrtWasmPlugin()],
  define: {
    __GIT_SHA__: JSON.stringify(getGitSha()),
  },
  // The GLiNER worker imports onnxruntime-web + Transformers.js as ES modules;
  // worker format must be `es` so Vite can resolve those imports correctly.
  worker: {
    format: 'es',
  },
  // Exclude the heavy WASM-backed modules from Vite's optimizeDeps scan: they
  // are loaded only inside the worker.
  optimizeDeps: {
    exclude: ['onnxruntime-web', '@xenova/transformers'],
  },
  // COOP/COEP intentionally NOT set. They will be needed when we enable
  // multi-threaded WASM via SharedArrayBuffer (later phase); enabling them
  // requires that every embedded subresource set Cross-Origin-Resource-Policy.
  // We currently run ort with `numThreads = 1` (single-threaded WASM), so
  // SharedArrayBuffer is unnecessary and COEP `require-corp` only causes
  // silent worker-import hangs on subresources that lack CORP (notably the
  // ORT wasm/mjs runtime files in `public/ort/`). When we move to
  // multi-threaded WASM, re-add `Cross-Origin-Opener-Policy: same-origin` +
  // `Cross-Origin-Embedder-Policy: require-corp` AND configure CORP headers
  // on all served subresources (vite preview headers + production server).
})
