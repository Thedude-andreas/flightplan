import { AppProviders } from './app/AppProviders'
import { AppRouter } from './app/AppRouter'
import './app/app-shell.css'

function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  )
}

export default App
