import { useMemo, useState } from 'react'

const betaDisclaimerStoragePrefix = 'vfrplan.betaDisclaimerAccepted'

function getStorageKey() {
  return `${betaDisclaimerStoragePrefix}.${__APP_VERSION__}`
}

function hasAcceptedDisclaimer() {
  try {
    return window.localStorage.getItem(getStorageKey()) === 'true'
  } catch {
    return false
  }
}

function acceptDisclaimer() {
  try {
    window.localStorage.setItem(getStorageKey(), 'true')
  } catch {
    // The dialog can still be dismissed for this render if localStorage is unavailable.
  }
}

export function BetaDisclaimerDialog() {
  const [isOpen, setIsOpen] = useState(() => !hasAcceptedDisclaimer())
  const recentCommits = useMemo(() => __RECENT_COMMITS__.slice(0, 5), [])

  if (!isOpen) {
    return null
  }

  const handleAccept = () => {
    acceptDisclaimer()
    setIsOpen(false)
  }

  return (
    <div className="dialog-backdrop beta-disclaimer" role="presentation">
      <section
        className="dialog-card beta-disclaimer__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="beta-disclaimer-title"
      >
        <div className="beta-disclaimer__content">
          <p className="app-eyebrow">Beta-testning</p>
          <h2 id="beta-disclaimer-title">Applikationen är under utveckling</h2>
          <p>Det innebär att:</p>
          <ul className="beta-disclaimer__list">
            <li>Alla moduler och funktioner inte är färdigutvecklade</li>
            <li>Otestade uppdateringar kan publiceras utan förvarning</li>
            <li>Visad information kan vara helt eller delvis baserad på dummydata utan verklighetsförankring</li>
          </ul>
          <p>
            Buggrapporter och utvecklingsförslag tas tacksamt emot på:{' '}
            <a href="mailto:info@vfrplan.se">info@vfrplan.se</a>
          </p>
        </div>

        {recentCommits.length ? (
          <div className="beta-disclaimer__commits" aria-label="Senaste commits">
            <h3>Senaste uppdateringar</h3>
            <ol>
              {recentCommits.map((commit) => (
                <li key={commit.hash}>
                  <time dateTime={commit.date}>{commit.date}</time>
                  <span>{commit.subject}</span>
                  <code>{commit.hash}</code>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="dialog-actions">
          <button type="button" onClick={handleAccept}>
            Meddelandet mottaget
          </button>
        </div>
      </section>
    </div>
  )
}
