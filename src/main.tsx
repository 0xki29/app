import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceScreen } from './workspace/WorkspaceScreen'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceScreen />
  </StrictMode>,
)
