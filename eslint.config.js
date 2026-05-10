// ESLint flat config — covers Node and browser sources separately so neither
// has to declare globals it doesn't use.
//
// Run with:  npm run lint

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,

  {
    // Server, tests, and config — Node environment.
    files: ['server.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        fetch: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  {
    // Browser-loaded JavaScript — no module system, runs in window globals.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        nacl: 'readonly',
        nacl_util: 'readonly',
        naclUtil: 'readonly',
        io: 'readonly',
        SC_Crypto: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'Math.random',
          message: 'Use crypto.getRandomValues — Math.random is not cryptographically safe.',
        },
      ],
    },
  },

  {
    ignores: ['node_modules/', 'public/vendor/', 'coverage/', 'dist/', '.cache/'],
  },
];
