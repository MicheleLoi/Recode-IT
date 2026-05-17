/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the GLiNER ONNX model URL. See `.env.example`. */
  readonly VITE_GLINER_MODEL_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
