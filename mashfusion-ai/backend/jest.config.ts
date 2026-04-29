import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }],
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/services/**/*.ts',
    '!src/**/__tests__/**',
  ],
  // Silence console.log during tests (logger uses winston internally)
  silent: false,
  // Don't connect to real DBs/Redis/SMTP in tests
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
}

export default config
