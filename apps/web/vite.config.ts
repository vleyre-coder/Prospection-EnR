import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configuration Vite de l'interface de prospection.
 *
 * `base: './'` permet de servir le build depuis n'importe quel prefixe d'URL
 * (l'API le sert via @fastify/static en production).
 */
/** Cible de l'API pour le proxy de developpement. */
const cibleApi = process.env['URL_API'] ?? 'http://localhost:3000';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: cibleApi, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    // Le build de production est servi par l'API via @fastify/static ; ce proxy ne sert
    // qu'a previsualiser le build localement.
    proxy: { '/api': { target: cibleApi, changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
});
