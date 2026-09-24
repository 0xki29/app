// @ts-check
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Lint is for correctness, not style: formatting and naming are left to review.
 *
 * `typescript` in package.json is TypeScript 6 (`@typescript/typescript6`) only because
 * typescript-eslint needs its JS API; `tsc` itself is TypeScript 7 (`@typescript/native`).
 */
export default defineConfig(
  globalIgnores([
    'dist/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    'blob-report/',
    // Data written by scripts, reviewed at its source rather than here.
    '**/*.generated.*',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Type-aware rules where every file belongs to a tsconfig (src → tsconfig.json, e2e →
    // e2e/tsconfig.json). The root config files get the syntax-only rules above.
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A dropped promise loses its rejection (scoring runs async); `void` marks a deliberate one.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // Modes, phases and verdicts are unions: a new member must be handled everywhere it is switched on.
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      // A missing dependency is a stale-closure bug: an error, not a warning.
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    rules: {
      // As tsc's noUnusedLocals: `_`-prefixed and rest-sibling names (`{ a: _, ...rest }`) are on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      eqeqeq: ['error', 'smart'],
      'array-callback-return': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
    },
  },
)
