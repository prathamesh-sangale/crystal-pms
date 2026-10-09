import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/web/src/generated/**',
      'source/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      eqeqeq: ['error', 'smart'],
    },
  },

  // The web app: React rules and the accessibility rules that catch at author
  // time what the axe run would otherwise catch at test time.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Icons are decorative by default and carry aria-hidden; the meaning
      // always sits in adjacent text.
      'jsx-a11y/no-redundant-roles': 'error',
      'jsx-a11y/label-has-associated-control': [
        'error',
        { assert: 'either', controlComponents: ['Checkbox.Root', 'Switch.Root'] },
      ],
      // A pane that scrolls has to be reachable by keyboard even though it is
      // not itself a control — axe reports the alternative as a serious
      // violation. Allowed only on a labelled region or group.
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        { tags: [], roles: ['group', 'region', 'tabpanel'], allowExpressionValues: true },
      ],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'apps/web/e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  {
    files: ['tools/**/*.mjs'],
    rules: { 'no-console': 'off' },
  }
);
