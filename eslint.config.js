import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const MODULES = ['tasks', 'feeds', 'chat', 'cockpit'];

/**
 * Module boundaries: code outside a module may only import its public
 * `index.ts`; modules never reach into each other's internals.
 */
function boundaryRules(own) {
  const others = MODULES.filter((name) => name !== own).join('|');
  const patterns = [
    {
      regex: `modules/(${others || MODULES.join('|')})/(?!index\\.(js|ts)$)`,
      message: 'Import other modules only through their public index.ts.',
    },
  ];
  if (own) {
    patterns.push({
      regex: `^\\.\\./(${others})/(?!index\\.(js|ts)$)`,
      message: 'Import other modules only through their public index.ts.',
    });
    patterns.push({ regex: '^\\.\\./\\.\\./(app|server)\\.js$|/mcp/', message: 'Modules must not depend on the app composition or MCP layer.' });
  }
  return { 'no-restricted-imports': ['error', { patterns }] };
}

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['src/**/*.ts'], ignores: ['src/modules/**'], rules: boundaryRules(undefined) },
  ...MODULES.map((name) => ({ files: [`src/modules/${name}/**/*.ts`], rules: boundaryRules(name) })),
  {
    files: ['web/**/*.ts', 'web/**/*.svelte', 'web/**/*.svelte.ts'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] },
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: '(^|/)src/(?!lib|components|views)', message: 'The web client must not import server code.' }] }],
    },
  },
);
