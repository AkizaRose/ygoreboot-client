import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// TEMPORARY — StrictMode removed as a diagnostic test (see the
// conversation this change came from): it deliberately double-invokes
// render functions and double-mounts every component on first mount,
// purely in development, to help surface impure rendering. Restore
// <StrictMode> once the animation bug is confirmed fixed — this isn't
// a permanent recommendation to drop it, just a way to rule it out as
// the source of what we were seeing.
createRoot(document.getElementById('root')!).render(
  <App />,
)