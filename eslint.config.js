import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

/**
 * The module table in ARCHITECTURE.md, enforced.
 *
 * Both that file and CLAUDE.md describe the boundaries as "enforced by
 * dependency direction", which was true only in the sense that someone had to
 * notice. Dependency direction is the load-bearing rule in this codebase —
 * `physics/` importing Three.js is what stops the simulation running in Node,
 * and `render/` importing `physics/` is what quietly made the camera part of the
 * car — so it is worth having the linter say so rather than a reviewer.
 *
 * `src/main.ts` is exempt: it is the composition root, and seeing the whole
 * graph is its job.
 */
const MODULES = ['ai', 'audio', 'core', 'game', 'input', 'physics', 'render', 'track', 'ui']

/** module -> what it may import, from the table in ARCHITECTURE.md. */
const MAY_IMPORT = {
  core: [],
  physics: ['core'],
  track: ['core'],
  input: ['core'],
  ai: ['core', 'track'],
  game: ['core', 'track'],
  render: ['core', 'track'],
  ui: ['core'],
  audio: ['core'],
}

const boundary = (module) => {
  const allowed = new Set([module, ...MAY_IMPORT[module]])
  const patterns = MODULES.filter((other) => !allowed.has(other)).map((other) => ({
    group: [`**/${other}`, `**/${other}/**`],
    message: `${module}/ may import only ${MAY_IMPORT[module].join(', ') || 'nothing'} — see the module table in ARCHITECTURE.md.`,
    // `ui/tuningPanel.ts` is the one sanctioned crossing: a dev-only chunk that
    // tunes the car, the input feel and the camera at once. It takes *types*
    // plus the live objects it is handed, so nothing on the simulation path
    // gains a dependency from it existing.
    allowTypeImports: module === 'ui',
  }))

  if (module === 'physics') {
    patterns.push({
      group: ['three', 'three/*'],
      message:
        'physics/ must stay pure so it runs headlessly in Node — importing Three.js here is a bug, not a shortcut.',
    })
  }

  return {
    files: [`src/${module}/**/*.ts`],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns }] },
  }
}

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  ...MODULES.map(boundary),
  prettier,
)
