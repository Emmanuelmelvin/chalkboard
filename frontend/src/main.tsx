import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { queryClient } from '@/api/queryClient'
import { initUserJot } from '@/lib/userjot'
import './index.css'
import './styles/ComponentStyles.css'
import App from './App.tsx'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    profilesSampleRate: Number(import.meta.env.VITE_SENTRY_PROFILES_SAMPLE_RATE ?? 0.1),
    tracePropagationTargets: [/^\//],
    integrations: [Sentry.browserTracingIntegration()],
  })
}

initUserJot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Sentry.ErrorBoundary fallback={<p>Something went wrong.</p>}>
        <App />
      </Sentry.ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
)
