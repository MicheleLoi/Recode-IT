/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the NER ONNX model URL. See `.env.example`. */
  readonly VITE_NER_MODEL_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
