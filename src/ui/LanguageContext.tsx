/**
 * LanguageContext.tsx — active document/NER language for the multi-language
 * pseudonymization pipeline.
 *
 * The context tracks ONE active language at a time. Selection drives:
 *   - which NER model is loaded (via {@link getModelUrl})
 *   - which pseudonym pool is used (Italian/English/German/French names)
 *   - which UI surface (brand label) is shown in the header
 *
 * Persistence: localStorage so the choice survives reload.
 *
 * Default: 'it' (Recode IT is the original/canonical product surface; the
 * other three are siblings under the same app, not separate apps).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { translate, type Language } from '../i18n/translations'

export type { Language }

export const SUPPORTED_LANGUAGES: ReadonlyArray<Language> = ['it', 'en', 'de', 'fr']

/** Brand label shown in the header for each language. */
export const BRAND_BY_LANG: Record<Language, string> = {
  it: 'Recode IT',
  en: 'ENcode',
  de: 'DEcode',
  fr: 'ChiFRer',
}

/** Tagline shown under the brand label. */
export const TAGLINE_BY_LANG: Record<Language, string> = {
  it: 'Pseudonimizzazione italiana, locale.',
  en: 'English pseudonymization, local.',
  de: 'Deutsche Pseudonymisierung, lokal.',
  fr: 'Pseudonymisation française, locale.',
}

/**
 * Map a language to the NER model URL. Same-origin paths so COEP/CORP
 * stays happy in production. Italian path preserved at the pre-multilingual
 * location for backward-compat (no need to move the existing file or update
 * nginx routing).
 */
export function getModelUrl(lang: Language): string {
  const override = (import.meta.env.VITE_NER_MODEL_URL as string | undefined) ?? ''
  if (override && lang === 'it') return override

  switch (lang) {
    case 'it':
      return '/models/distilbert_italian_ner_q8.onnx'
    case 'en':
      return '/models/en/model_quantized.onnx'
    case 'de':
      return '/models/de/model_quantized.onnx'
    case 'fr':
      return '/models/fr/model_quantized.onnx'
  }
}

const STORAGE_KEY = 'recode-it.language'

type LanguageContextValue = {
  language: Language
  setLanguage: (lang: Language) => void
  /**
   * Resolve a UI string key to the active language. Falls back to Italian
   * (canonical source) when the active language is missing the key, then
   * to the raw key as last resort so the UI never renders empty.
   */
  t: (key: string) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'it'
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v && (SUPPORTED_LANGUAGES as ReadonlyArray<string>).includes(v)) {
      return v as Language
    }
  } catch {
    // localStorage unavailable (private mode, SSR) → fall through.
  }
  return 'it'
}

export function LanguageProvider({ children }: { children: ReactNode }): JSX.Element {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage())

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    try {
      window.localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // ignore — persistence is best-effort.
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const t = useCallback((key: string) => translate(language, key), [language])

  const value = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  )
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

/**
 * Default language context used when the hook is consumed outside any
 * provider — typically in test environments that don't wrap the component
 * tree. Returning a safe default (no-op setter) keeps existing tests
 * passing without forcing every test to install the provider.
 */
const DEFAULT_LANG_CTX: LanguageContextValue = {
  language: 'it',
  setLanguage: () => {
    /* no-op when outside a provider */
  },
  t: (key: string) => translate('it', key),
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  return ctx ?? DEFAULT_LANG_CTX
}
