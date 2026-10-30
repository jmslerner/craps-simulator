import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Workers are ES modules so they can import the engine and Rapier like any other module.
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // M14: the libraries the first paint needs (React, zod) ride in a chunk of their own, so
        // neither initial chunk crosses Vite's 500 kB warning. index.html preloads both, and
        // scripts/check-bundle.ts counts them together against the 250 kB gzip initial budget.
        // The lazy dome chunk (three.js) still passes 500 kB raw; its budget is check-bundle's
        // 350 kB gzip.
        codeSplitting: {
          groups: [
            { name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler|zod)[\\/]/ },
          ],
        },
      },
    },
  },
})
