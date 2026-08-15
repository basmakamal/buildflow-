import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettier from 'eslint-config-prettier'

export default ts.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      'packages/ui/icon-gallery.html',
    ],
  },

  js.configs.recommended,
  ...ts.configs.strictTypeChecked,
  ...vue.configs['flat/recommended'],
  prettier,

  // Type-aware linting for TypeScript sources.
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },

  // Single-file components. vue-eslint-parser handles the template; the <script
  // lang="ts"> block needs the TypeScript parser delegated to it explicitly, and
  // `.vue` must be declared as an extra extension or the project service will
  // not associate the file with a tsconfig.
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.vue'],
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
    },
  },

  // Project rules. Scoped to TS and SFCs — several of these require type
  // information, and applying them to plain JS config files makes ESLint abort
  // rather than skip. Scope, do not disable-then-re-enable.
  {
    files: ['**/*.ts', '**/*.vue'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // Off deliberately. The rule predates typed props: with `defineProps<T>()`
      // an optional prop's absence is meaningful (`tone` falls back to the
      // trade-derived colour, `label` marks the icon decorative). Forcing a
      // default would erase that distinction. TypeScript already enforces the
      // contract.
      'vue/require-default-prop': 'off',
    },
  },

  // Config files and build scripts are plain JS outside any tsconfig, so
  // type-aware rules cannot apply. This block must come after every typed
  // block, because the last matching entry wins.
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...ts.configs.disableTypeChecked,
    languageOptions: {
      ...ts.configs.disableTypeChecked.languageOptions,
      globals: { console: 'readonly', process: 'readonly', module: 'writable' },
    },
    rules: {
      ...ts.configs.disableTypeChecked.rules,
      'no-undef': 'off',
    },
  },

  // -------------------------------------------------------------------------
  // No hardcoded user-facing strings. docs/12 §3.4.
  //
  // Enforced from the first commit, not added later. Retrofitting i18n into a
  // codebase with thousands of literals is a multi-month project that never
  // gets funded — so English leaks into the Arabic UI permanently.
  // -------------------------------------------------------------------------
  {
    files: ['apps/web/**/*.vue', 'packages/ui/**/*.vue'],
    rules: {
      'vue/no-bare-strings-in-template': [
        'error',
        {
          // Punctuation, units, and currency codes read identically in Arabic
          // and English, so requiring a translation key for them adds noise
          // without adding meaning. Everything else must go through i18n.
          allowlist: [
            '(', ')', ',', '.', '&', '+', '-', '=', '*', '/', '#', '%',
            '·', '—', '–', ':', ';', '!', '?', '|', '×', '→', '←', '↑', '↓',
            'm', 'm²', 'm³', 'mm', 'cm', 'kg', 'L',
            'SAR', 'AED', 'EGP', 'KWD', 'QAR', 'BHD', 'OMR', 'USD',
            'BuildFlow',
          ],
          attributes: {
            '/.+/': ['title', 'aria-label', 'aria-placeholder', 'aria-valuetext'],
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
  // Crude, and effective: a controller needing 15+ statements is orchestrating
  // business logic that belongs in a command handler.
  // -------------------------------------------------------------------------
  {
    files: ['**/interface/controllers/**/*.ts'],
    rules: {
      'max-statements': ['error', 15],
      complexity: ['error', 6],
    },
  },

  // Domain layer performs no I/O and reads no ambient time — inject a Clock
  // port so behaviour is deterministic in tests. docs/06 §1.
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
