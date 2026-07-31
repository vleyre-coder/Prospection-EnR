import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import './styles/global.css';

/**
 * Les donnees de qualification sont couteuses a produire (interrogation de plusieurs API
 * officielles soumises a limitation de debit) : le cache est donc volontairement long et
 * les rechargements automatiques desactives.
 */
const cache = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const racine = document.getElementById('racine');
if (!racine) throw new Error('Element racine introuvable');

createRoot(racine).render(
  <StrictMode>
    <QueryClientProvider client={cache}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
