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
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        /**
         * Decoupage du paquet.
         *
         * Tout partait en un seul fragment de 1,1 Mo : le premier affichage attendait donc
         * le telechargement de MapLibre entier avant le moindre pixel, y compris pour un
         * utilisateur qui ouvre la vue liste. Les trois blocs isoles ici sont volumineux,
         * stables d'une version a l'autre, et donc bien caches par le navigateur : une mise
         * a jour de l'application ne les fait pas retelecharger.
         */
        manualChunks: {
          // Le plus gros morceau, et le seul qui ne serve qu'a la carte.
          maplibre: ['maplibre-gl'],
          react: ['react', 'react-dom'],
          requetes: ['@tanstack/react-query', 'zustand'],
        },
      },
    },
  },
});
