import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { watchChunkErrors } from './ui/recover'
import { forgetBrokenTypesOnIos } from './data/mediaPrep'
import { watchBackButton } from './platform'
import './styles.css'

watchBackButton()
watchChunkErrors()
forgetBrokenTypesOnIos()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary root>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
