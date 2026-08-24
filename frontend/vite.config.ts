import { execSync } from 'node:child_process'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

let release = process.env.VITE_SENTRY_RELEASE || process.env.SENTRY_RELEASE
if (!release) {
  try {
    release = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    release = 'dev'
  }
}
process.env.VITE_SENTRY_RELEASE = release

const sentryPlugins =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: {
          name: release,
        },
        sourcemaps: {
          assets: ['dist/**'],
          filesToDeleteAfterUpload: 'dist/**/*.map',
        },
      })
    : []

// https://vite.dev/config/
const sharedDir = fs.existsSync(path.resolve(__dirname, '../shared'))
  ? path.resolve(__dirname, '../shared')
  : path.resolve(__dirname, './src/shared');

export default defineConfig({
  plugins: [react(), ...sentryPlugins],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': sharedDir,
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: [
      'chalkboard.outray.app'
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
  },
  build: {
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('wouter') || id.includes('zustand') || id.includes('@tanstack/react-query')) {
              return 'vendor-react';
            }
            if (id.includes('livekit-client') || id.includes('@livekit')) {
              return 'vendor-livekit';
            }
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) {
              return 'vendor-charts';
            }
            if (id.includes('lucide-react') || id.includes('@radix-ui')) {
              return 'vendor-ui';
            }
            if (id.includes('socket.io-client') || id.includes('axios')) {
              return 'vendor-net';
            }
            if (id.includes('@sentry')) {
              return 'vendor-sentry';
            }
          }
        },
      },
    },
  },
})
