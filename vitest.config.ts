import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: { tsconfig: false },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
})
