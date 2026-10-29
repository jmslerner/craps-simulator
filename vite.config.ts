import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Workers are ES modules so they can import the engine and Rapier like any other module.
  worker: { format: 'es' },
})
