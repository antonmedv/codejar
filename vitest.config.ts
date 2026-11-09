import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      // Run a single browser with `vitest --project chromium`.
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }],
    },
  },
})
