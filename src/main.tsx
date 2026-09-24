import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { installGlobalErrorHandlers } from './app/errorReporting'
import './styles.css'

installGlobalErrorHandlers()

createRoot(document.getElementById('root')!, {
  // Every boundary logs what it catches, with the build info (ErrorBoundary): no second log.
  onCaughtError: () => {},
}).render(
  <StrictMode>
    <ErrorBoundary context="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
