// vite.config.js
import { defineConfig } from 'vite';
import injectHTML from 'vite-plugin-html-inject';

export default defineConfig({
  base: '/sanbox/',
  plugins: [
    injectHTML()
  ],
  build: {
    sourcemap: false
  },
  server: {
    sourcemapIgnoreList: () => true
  }
});