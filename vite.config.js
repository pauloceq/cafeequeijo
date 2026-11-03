import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' + HashRouter = funciona no GitHub Pages em qualquer endereço
export default defineConfig({
  plugins: [react()],
  base: './',
})
