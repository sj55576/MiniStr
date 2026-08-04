import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // The game deliberately uses concise internal helpers. Public boundaries
      // are typed, while this rule prevents accidental implicit `any` values.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      // Tests intentionally exercise malformed runtime values at public input boundaries.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
