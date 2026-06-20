import { useMemo, useState } from 'react'

const betaDisclaimerStoragePrefix = 'vfrplan.betaDisclaimerAccepted'
const maxRecentUpdateDays = 5

type RecentCommit = {
  hash: string
  date: string
  subject: string
}

type RecentUpdateDay = {
  date: string
  subjects: string[]
  hashes: string[]
}

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

function formatUpdateDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return date
  }

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
  }).format(parsed)
}

function groupCommitsByDate(commits: RecentCommit[]): RecentUpdateDay[] {
  const grouped = new Map<string, RecentUpdateDay>()

  for (const commit of commits) {
    const existing = grouped.get(commit.date)
    if (existing) {
      existing.subjects.push(commit.subject)
      existing.hashes.push(commit.hash)
      continue
    }

    grouped.set(commit.date, {
      date: commit.date,
      subjects: [commit.subject],
      hashes: [commit.hash],
    })
  }

  return Array.from(grouped.values()).slice(0, maxRecentUpdateDays)
}

export function BetaDisclaimerDialog() {
  const [isOpen, setIsOpen] = useState(() => !hasAcceptedDisclaimer())
  const recentUpdateDays = useMemo(() => groupCommitsByDate(__RECENT_COMMITS__), [])

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
        <img className="beta-disclaimer__image" src="/Start-dialog.png" alt="" />
        <div className="beta-disclaimer__body">
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

          {recentUpdateDays.length ? (
            <div className="beta-disclaimer__commits" aria-label="Senaste uppdateringar">
              <h3>Senaste uppdateringar</h3>
              <ol>
                {recentUpdateDays.map((day) => (
                  <li key={day.date}>
                    <div className="beta-disclaimer__commits-day">
                      <time dateTime={day.date}>{formatUpdateDate(day.date)}</time>
                      <code>{day.hashes[0]}</code>
                    </div>
                    <ul>
                      {day.subjects.map((subject, index) => (
                        <li key={`${day.hashes[index]}-${subject}`}>{subject}</li>
                      ))}
                    </ul>
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
        </div>
      </section>
    </div>
  )
}
