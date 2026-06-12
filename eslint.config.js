import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', '.remember/**', '.vs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    files: ['src/client/**/*.ts'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        WebSocket: 'readonly',
        requestAnimationFrame: 'readonly',
        performance: 'readonly',
        HTMLCanvasElement: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        KeyboardEvent: 'readonly',
      },
    },
  },
  {
    // Node-run headless scripts (screenshot + playtest harnesses): Node globals, plus the browser
    // globals the Playwright `page.evaluate` callbacks reference (they run in the page context).
    files: ['scripts/**/*.mjs', 'tools/playtest/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        document: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
  },
);
