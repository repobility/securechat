// ESLint flat config — covers Node and browser sources separately so neither
// has to declare globals it doesn't use.
//
// Run with:  npm run lint

const js = require('@eslint/js');
const globals = require('globals');

/**
 * Build the ESLint flat config.
 * @returns {import('eslint').Linter.Config[]}
 */
function buildConfig() {
  return [
    js.configs.recommended,
    nodeLayer(),
    browserLayer(),
    { ignores: ['node_modules/', 'public/vendor/', 'coverage/', 'dist/', '.cache/'] },
  ];
}

/**
 * Lint rules for server, tests, and config files (Node environment).
 * @returns {import('eslint').Linter.Config}
 */
function nodeLayer() {
  return {
    files: ['server.js', 'src/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
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
  };
}

/**
 * Lint rules for browser-loaded JavaScript. No module system; runs in
 * window globals. Bans `Math.random` so security-adjacent code uses
 * crypto.getRandomValues instead.
 * @returns {import('eslint').Linter.Config}
 */
function browserLayer() {
  return {
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
  };
}

module.exports = buildConfig();
