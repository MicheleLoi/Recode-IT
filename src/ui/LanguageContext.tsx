/**
 * LanguageContext.tsx — TWO independent language axes:
 *
 *   1. UI language  — drives the t() string lookups (nav, banners, panels,
 *      buttons), the product brand (h1) and the tagline. This is the
 *      language the *user* reads the app in.
 *   2. Document language — drives which NER model is loaded into the
 *      worker (it=DistilBERT-italian / en=BERT-base-NER / ...) and which
 *      pseudonym pool the PseudonymMapper allocates from. This is the
 *      language of the *document* being processed.
 *
 * The two axes are independent so an Italian-speaking lawyer (UI=it) can
 * pseudonymize an English WhatsApp chat (doc=en) without giving up their
 * preferred interface language.
 *
 * Persistence:
 *   - localStorage['recode-it.uiLanguage']
 *   - localStorage['recode-it.docLanguage']
 *   - Migration: any legacy localStorage['recode-it.language'] is honored
 *     once as the default for BOTH axes, then superseded by the new keys.
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

/** Brand label shown in the header for each UI language. */
export const BRAND_BY_LANG: Record<Language, string> = {
  it: 'Recode IT',
  en: 'ENcode',
  de: 'DEcode',
  fr: 'ChiFRer',
}

/** Tagline shown under the brand label (UI language). */
export const TAGLINE_BY_LANG: Record<Language, string> = {
  it: 'Pseudonimizzazione italiana, locale.',
  en: 'English pseudonymization, local.',
  de: 'Deutsche Pseudonymisierung, lokal.',
  fr: 'Pseudonymisation française, locale.',
}

/**
 * Map a DOCUMENT language to the NER model URL. Same-origin paths so
 * COEP/CORP stays happy in production. Italian path preserved at the
 * pre-multilingual location for backward-compat.
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

const UI_KEY = 'recode-it.uiLanguage'
const DOC_KEY = 'recode-it.docLanguage'
const LEGACY_KEY = 'recode-it.language'

type LanguageContextValue = {
  /** UI language — affects t(), brand label, tagline. */
  uiLanguage: Language
  setUiLanguage: (lang: Language) => void
  /** Document language — affects NER model + pseudonym pool. */
  docLanguage: Language
  setDocLanguage: (lang: Language) => void
  /** Resolve a UI string key against the active UI language. */
  t: (key: string) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function readStoredLanguage(key: string, fallback: Language = 'it'): Language {
  if (typeof window === 'undefined') return fallback
  try {
    const v = window.localStorage.getItem(key)
    if (v && (SUPPORTED_LANGUAGES as ReadonlyArray<string>).includes(v)) {
      return v as Language
    }
    // One-time migration from the pre-split single-axis key.
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (legacy && (SUPPORTED_LANGUAGES as ReadonlyArray<string>).includes(legacy)) {
      return legacy as Language
    }
  } catch {
    /* localStorage unavailable (private mode, SSR) → fall through. */
  }
  return fallback
}

export function LanguageProvider({ children }: { children: ReactNode }): JSX.Element {
  const [uiLanguage, setUiLanguageState] = useState<Language>(() =>
    readStoredLanguage(UI_KEY),
  )
  const [docLanguage, setDocLanguageState] = useState<Language>(() =>
    readStoredLanguage(DOC_KEY),
  )

  const setUiLanguage = useCallback((lang: Language) => {
    setUiLanguageState(lang)
    try {
      window.localStorage.setItem(UI_KEY, lang)
    } catch {
      /* persistence is best-effort */
    }
  }, [])

  const setDocLanguage = useCallback((lang: Language) => {
    setDocLanguageState(lang)
    try {
      window.localStorage.setItem(DOC_KEY, lang)
    } catch {
      /* persistence is best-effort */
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = uiLanguage
  }, [uiLanguage])

  const t = useCallback((key: string) => translate(uiLanguage, key), [uiLanguage])

  const value = useMemo(
    () => ({ uiLanguage, setUiLanguage, docLanguage, setDocLanguage, t }),
    [uiLanguage, setUiLanguage, docLanguage, setDocLanguage, t],
  )
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

/**
 * Default language context used when the hook is consumed outside any
 * provider — typically in test environments that don't wrap the component
 * tree. Returning a safe default keeps existing tests passing.
 */
const DEFAULT_LANG_CTX: LanguageContextValue = {
  uiLanguage: 'it',
  setUiLanguage: () => {
    /* no-op when outside a provider */
  },
  docLanguage: 'it',
  setDocLanguage: () => {
    /* no-op when outside a provider */
  },
  t: (key: string) => translate('it', key),
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  return ctx ?? DEFAULT_LANG_CTX
}
