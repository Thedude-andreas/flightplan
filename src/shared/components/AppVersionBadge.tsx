const appVersion = __APP_VERSION__

export function AppVersionBadge() {
  return <div className="app-version-badge">Build {appVersion}</div>
}
