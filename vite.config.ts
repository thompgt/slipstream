import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Deployed under https://<user>.github.io/slipstream/, so assets need a scoped base.
  base: process.env.GITHUB_ACTIONS ? '/slipstream/' : '/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
