import { defineConfig } from 'vite'

export default defineConfig({
  base: '/3d-dominoes/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          physics: ['cannon-es'],
        },
      },
    },
  },
})
