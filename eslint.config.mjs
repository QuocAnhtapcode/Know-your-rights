import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/**', 'functions/node_modules/**', 'dist/**', 'functions/lib/**', '.tools/**', '.tmp/**', '.firebase/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': ['error', { patterns: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*', 'openai', 'openai/*', 'firebase/firestore', 'firebase/storage', '**/functions/**', 'node:*'] }],
    },
  },
];
