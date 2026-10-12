import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import sv from '@/locales/sv.json'
import en from '@/locales/en.json'

export const LANGUAGES = ['sv', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

const STORAGE_KEY = 'crm.language'

function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return LANGUAGES.includes(value as Language) ? (value as Language) : 'sv'
  } catch {
    return 'sv'
  }
}

// Until users have a saved locale (Sprint 1), the choice is kept in localStorage.
export function setLanguage(lang: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Storage can be blocked; the language still changes for this session.
  }
  document.documentElement.lang = lang
  return i18n.changeLanguage(lang)
}

export const resources = { sv: { translation: sv }, en: { translation: en } } as const

i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage(),
  fallbackLng: 'sv',
  interpolation: { escapeValue: false },
})
document.documentElement.lang = i18n.language

export default i18n
