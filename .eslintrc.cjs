module.exports = {
  root: true,
  env: {
    node: true,
    es2023: true,
    jest: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json'],
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  rules: {
    // Disallow unused variables except for ignored args (starting with _)
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // Allow console statements but warn about them in production code
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    // Stylistic preferences (adjust to your liking)
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'always'],
  },
  overrides: [
    {
      files: ['tests/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
      env: { jest: true },
      rules: {
        // Relax some rules for test files
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};