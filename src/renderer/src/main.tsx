import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

document.documentElement.dataset.platform = /mac/i.test(navigator.platform)
  ? 'mac'
  : 'other'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
)
