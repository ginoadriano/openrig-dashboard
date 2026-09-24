import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // inotify does not fire on /mnt/c (drvfs) under WSL; poll so edits are actually served.
    watch: { usePolling: true, interval: 500 },
    proxy: {
      '/dash': {
        target: 'http://127.0.0.1:7500',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
