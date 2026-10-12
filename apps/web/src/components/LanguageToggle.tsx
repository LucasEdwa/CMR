import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LANGUAGES, setLanguage } from '@/lib/i18n'

export function LanguageToggle({ onChange }: { onChange?: (lang: (typeof LANGUAGES)[number]) => void }) {
  const { t, i18n } = useTranslation()
  return (
    <div role="group" aria-label={t('language.label')} className="flex gap-1">
      {LANGUAGES.map((lang) => (
        <Button
          key={lang}
          size="sm"
          variant={i18n.language === lang ? 'secondary' : 'ghost'}
          aria-pressed={i18n.language === lang}
          onClick={() => {
            void setLanguage(lang)
            onChange?.(lang)
          }}
        >
          {t(`language.${lang}`)}
        </Button>
      ))}
    </div>
  )
}
