import { Link } from 'react-router-dom'

export function LandingPage() {
  return (
    <div className="marketing-hero">
      <div className="marketing-hero__content">
        <p className="marketing-hero__eyebrow">Flightplan</p>
        <h1>Driftfärdplaner, karteditor och flygplansprofiler i samma arbetsyta.</h1>
        <p className="marketing-hero__lede">
          Logga in för att spara egna färdplaner och flygplansprofiler. Version 1 är privat per användare och byggd för att tåla tillfälliga avbrott utan att kasta bort arbete.
        </p>
        <div className="marketing-hero__actions">
          <Link to="/login" className="button-link button-link--primary">
            Logga in
          </Link>
          <Link to="/signup" className="button-link">
            Skapa konto
          </Link>
        </div>
      </div>
    </div>
  )
}
