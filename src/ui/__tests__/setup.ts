import '@testing-library/jest-dom/vitest'

/**
 * jsdom polyfills.
 *
 * jsdom 25 ships a `File` class that lacks the `arrayBuffer()` and `text()`
 * Blob-API methods present in modern browsers and Node 18+. The extraction
 * dispatcher depends on both, so we patch them onto `File.prototype` when
 * missing. Implementation pulls bytes via the underlying Blob (jsdom's File
 * extends Blob), then materializes them as text/ArrayBuffer.
 */
if (typeof File !== 'undefined') {
  const proto = File.prototype as File & {
    arrayBuffer?: () => Promise<ArrayBuffer>
    text?: () => Promise<string>
  }
  if (typeof proto.arrayBuffer !== 'function') {
    proto.arrayBuffer = async function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
        reader.readAsArrayBuffer(this)
      })
    }
  }
  if (typeof proto.text !== 'function') {
    proto.text = async function text(this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
        reader.readAsText(this)
      })
    }
  }
}
