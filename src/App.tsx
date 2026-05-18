import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AppProviders } from './app/AppProviders'
import { AppRouter } from './app/AppRouter'
import './app/app-shell.css'

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App render failed', error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-shell-error">
          <h1>Något gick fel</h1>
          <p>{this.state.error.message}</p>
        </main>
      )
    }

    return this.props.children
  }
}

function App() {
  return (
    <AppErrorBoundary>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </AppErrorBoundary>
  )
}

export default App
