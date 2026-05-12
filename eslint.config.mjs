import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import tsparser from '@typescript-eslint/parser';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: './tsconfig.json' },
      globals: {
        PLUGIN_VERSION: 'readonly',
      },
    },
    rules: {
      'obsidianmd/ui/sentence-case': [
        'error',
        {
          brands: ['Granola', 'GitHub'],
          acronyms: [
            'YYYY',
            'MM',
            'DD',
            'HH',
            'Q1',
            'Q2',
            'Q3',
            'Q4',
            'API',
            'JSON',
            'URL',
          ],
        },
      ],
    },
  },
);
