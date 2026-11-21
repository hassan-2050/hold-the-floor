import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'probe/logs/**', 'test-results/**', 'playwright-report/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The core must stay pure: no Electron, React or SDK in turn/ and features/.
    files: ['src/turn/**', 'src/features/**', 'src/audio/detector.ts', 'src/results/**', 'config/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['electron', 'react', 'react-dom', 'zustand', '@smartspectra/*'] },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, AudioWorkletProcessor: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
);
