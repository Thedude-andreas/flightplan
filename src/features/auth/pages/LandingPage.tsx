import { Link } from 'react-router-dom'

export function LandingPage() {
  return (
    <div className="marketing-hero">
      <div className="marketing-hero__content">
        <p className="marketing-hero__eyebrow">VFRplan.se</p>
        <h1>Driftfärdplaner, karteditor och flygplansprofiler i samma arbetsyta.</h1>
        <p className="marketing-hero__lede">
          Färdplaneringsverktyg på en karta som inte är kass, byggt för att göra planeringen snabb, tydlig och faktiskt användbar i verkligheten.
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
