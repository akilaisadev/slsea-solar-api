import js from '@eslint/js';
import globals from 'globals';

// One shared style for every JavaScript file, checked in CI, so code
// quality is enforced by a tool rather than by eye.
export default [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Correctness
      eqeqeq: ['error', 'always'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-shadow': 'error',
      'no-param-reassign': ['error', { props: false }],
      'no-return-await': 'off',
      'require-await': 'error',
      // Consistency
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
      curly: ['error', 'multi-line'],
      'no-console': ['error', { allow: ['log', 'error', 'table'] }],
    },
  },
  {
    // Tests replace console methods temporarily to capture log output.
    files: ['test/**/*.js'],
    rules: { 'no-console': 'off' },
  },
];
