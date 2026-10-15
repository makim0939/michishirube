import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { forgetBrokenTypesOnIos } from './data/mediaPrep'
import { watchBackButton } from './platform'
import './styles.css'

watchBackButton()
forgetBrokenTypesOnIos()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
