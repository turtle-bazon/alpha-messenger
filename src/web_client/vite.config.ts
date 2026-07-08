import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Базовый URL сервера задаётся через VITE_API_URL (по умолчанию локальный стек).
// REST и WS клиент берут его из import.meta.env (см. src/api).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
});
