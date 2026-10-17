// vite.config.js
import { defineConfig } from 'vite';
import htmlInject from 'vite-plugin-html-inject';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    htmlInject(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,jpeg,svg,woff2}']
      },
      manifest: {
        name: 'Lokalex Delivery Hub',
        short_name: 'Lokalex',
        description: 'Lokalex Logistics • On-Demand Express Delivery',
        theme_color: '#EDF7F2',
        background_color: '#EDF7F2',
        display: 'standalone',
        start_url: './',
        icons: [
          {
            src: 'Logo.png',
            sizes: '192x192 512x512',
            type: 'image/png'
          }
        ]
      },
      devOptions: {
        enabled: false,
        type: 'module'
      }
    })
  ]
});