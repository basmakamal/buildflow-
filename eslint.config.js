import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'

export default ts.config(
  { ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/.nuxt/**', '**/node_modules/**'] },

  js.configs.recommended,
  ...ts.configs.strictTypeChecked,
  ...vue.configs['flat/recommended'],
  prettier,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // -------------------------------------------------------------------------
  // No hardcoded user-facing strings. docs/12 §3.4.
  //
  // This rule is enforced from the first commit, not added later. Retrofitting
  // i18n into a codebase with thousands of literals is a multi-month project
  // that never gets funded — so English leaks into the Arabic UI forever.
  // -------------------------------------------------------------------------
  {
    files: ['apps/web/**/*.vue', 'packages/ui/**/*.vue'],
    rules: {
      'vue/no-bare-strings-in-template': [
        'error',
        {
          allowlist: [
            '(', ')', ',', '.', '&', '+', '-', '=', '*', '/', '#', '%', '·', '—', '–',
            ':', ';', '!', '?', '|', '×', '→', '←', '↑', '↓',
            'm', 'm²', 'm³', 'kg', 'L', '%', 'SAR', 'AED', 'EGP', 'USD', 'mm', 'cm',
            'BuildFlow',
          ],
          attributes: {
            '/.+/': ['title', 'aria-label', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext'],
            input: ['placeholder'],
            img: ['alt'],
          },
          directives: ['v-text'],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Controllers stay thin. docs/06 §1.1.
  // Crude, and effective: a controller that needs 15+ statements is orchestrating
  // business logic that belongs in a command handler.
  // -------------------------------------------------------------------------
  {
    files: ['**/interface/controllers/**/*.ts'],
    rules: {
      'max-statements': ['error', 15],
      complexity: ['error', 6],
    },
  },

  // Domain layer: no I/O primitives, and no ambient time — inject a Clock port
  // so behaviour is deterministic in tests. docs/06 §1.
  {
    files: ['**/domain/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Domain layer performs no I/O. Define a port instead.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Inject the Clock port instead of reading ambient time. See docs/06 §1.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Inject the Clock port instead of reading ambient time. See docs/06 §1.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Inject the IdGenerator/Random port so domain behaviour is reproducible.',
        },
      ],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off', 'max-statements': 'off' },
  },
)
