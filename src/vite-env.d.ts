/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the NER ONNX model URL. See `.env.example`. */
  readonly VITE_NER_MODEL_URL?: string
  /**
   * DEV-ONLY flag: set to '1' to activate mock mode (no backend required).
   * Swaps AuthProvider with MockAuthProvider so the app runs with a faked
   * logged-in user + Decodifica unlocked — for pre-deploy e2e testing.
   * Only takes effect when combined with import.meta.env.DEV === true.
   * Usage: VITE_MOCK_FULL=1 npm run dev  (or npm run dev:mock)
   * Lives only on branch mock/e2e-test-build — never set in production.
   */
  readonly VITE_MOCK_FULL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
