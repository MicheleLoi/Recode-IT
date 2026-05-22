/**
 * PrivacyPage — plain-language privacy notice for the Recode IT product
 * family (Recode IT / ENcode / DEcode / ChiFRer). Rendered as an in-app
 * React route at `/privacy`. All text is translated via `t()` so the
 * page follows the active UI language.
 *
 * Content is factual and reflects the actual data flow of the product
 * as of the date in `privacy.lastUpdated`: nothing aspirational, no
 * future-looking promises. If you change a data flow (add a new
 * third-party service, change persistence model, etc.) update the
 * corresponding translation block AND bump the date.
 */

import { useLanguage } from './LanguageContext'

type Props = {
  onBack: () => void
}

export function PrivacyPage({ onBack }: Props): JSX.Element {
  const { t } = useLanguage()
  return (
    <section className="panel panel--privacy" aria-label={t('privacy.title')}>
      <header className="panel__header">
        <h2>{t('privacy.title')}</h2>
        <p className="panel__subtitle">{t('privacy.lastUpdated')}</p>
      </header>

      <article className="privacy-content">
        <section>
          <h3>{t('privacy.intro.title')}</h3>
          <p>{t('privacy.intro.body')}</p>
        </section>

        <section>
          <h3>{t('privacy.local.title')}</h3>
          <p>{t('privacy.local.body')}</p>
          <ul>
            <li>{t('privacy.local.list.document')}</li>
            <li>{t('privacy.local.list.ner')}</li>
            <li>{t('privacy.local.list.mapping')}</li>
            <li>{t('privacy.local.list.manual')}</li>
          </ul>
        </section>

        <section>
          <h3>{t('privacy.server.title')}</h3>
          <p>{t('privacy.server.body')}</p>
          <ul>
            <li>{t('privacy.server.list.email')}</li>
            <li>{t('privacy.server.list.name')}</li>
            <li>{t('privacy.server.list.marketing')}</li>
            <li>{t('privacy.server.list.password')}</li>
          </ul>
          <p className="privacy-note">{t('privacy.server.note')}</p>
        </section>

        <section>
          <h3>{t('privacy.store.title')}</h3>
          <p>{t('privacy.store.body')}</p>
          <ul>
            <li>
              <strong>{t('privacy.store.anonymous.title')}</strong>{' '}
              {t('privacy.store.anonymous.body')}
            </li>
            <li>
              <strong>{t('privacy.store.free.title')}</strong>{' '}
              {t('privacy.store.free.body')}
            </li>
            <li>
              <strong>{t('privacy.store.paid.title')}</strong>{' '}
              {t('privacy.store.paid.body')}
            </li>
          </ul>
        </section>

        <section>
          <h3>{t('privacy.thirdParty.title')}</h3>
          <p>{t('privacy.thirdParty.body')}</p>
          <ul>
            <li>{t('privacy.thirdParty.list.resend')}</li>
            <li>{t('privacy.thirdParty.list.stripe')}</li>
            <li>{t('privacy.thirdParty.list.noAI')}</li>
            <li>{t('privacy.thirdParty.list.noAnalytics')}</li>
          </ul>
        </section>

        <section>
          <h3>{t('privacy.cookies.title')}</h3>
          <p>{t('privacy.cookies.body')}</p>
          <ul>
            <li>{t('privacy.cookies.list.language')}</li>
            <li>{t('privacy.cookies.list.indexeddb')}</li>
            <li>{t('privacy.cookies.list.session')}</li>
          </ul>
        </section>

        <section>
          <h3>{t('privacy.rights.title')}</h3>
          <p>{t('privacy.rights.body')}</p>
          <ul>
            <li>{t('privacy.rights.list.delete')}</li>
            <li>{t('privacy.rights.list.export')}</li>
            <li>{t('privacy.rights.list.contact')}</li>
          </ul>
        </section>

        <section>
          <h3>{t('privacy.contact.title')}</h3>
          <p>{t('privacy.contact.body')}</p>
          <address className="privacy-contact">
            Michele Loi<br />
            <a href="mailto:mhcl@micheleloi.pro">mhcl@micheleloi.pro</a>
          </address>
        </section>

        <section>
          <h3>{t('privacy.changes.title')}</h3>
          <p>{t('privacy.changes.body')}</p>
        </section>
      </article>

      <div className="actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onBack}
          data-testid="privacy-back-btn"
        >
          {t('privacy.back')}
        </button>
      </div>
    </section>
  )
}
