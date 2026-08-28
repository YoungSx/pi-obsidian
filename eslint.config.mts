import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				// Electron's safeStorage (API-key encryption) hands back Buffers,
				// so the desktop path references the Node global inside this
				// browser-globals config.
				Buffer: "readonly",
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// The load harness is build-time tooling, not plugin runtime code: it
		// reads the built bundle off disk and evaluates it the way Obsidian's
		// loader does. Node builtins and `eval` are the mechanism under test,
		// so the rules that rightly forbid them in the plugin are scoped off
		// here — and only here, by exact path.
		files: ["src/testing/pluginLoader.ts", "src/testing/pluginLoader.test.ts"],
		rules: {
			"import/no-nodejs-modules": "off",
			"no-eval": "off",
			// The stub app models a default vault layout; it is not reading a
			// real user's configuration, so it has no configDir to consult.
			"obsidianmd/hardcoded-config-path": "off",
		},
	},
	{
		// Build-time tooling, not plugin runtime code: the copy gate reads the
		// source tree off disk, and its test drives the gate as a subprocess over
		// scratch files, so `node:fs` and the Bun runner's globals are the
		// mechanism rather than an oversight. The rules that rightly keep Node
		// builtins out of a mobile-capable plugin are scoped off by path, the same
		// way `pluginLoader` is above — nothing under `scripts/` is bundled into
		// `main.js`.
		files: ["scripts/**/*.ts", "scripts/**/*.mjs"],
		languageOptions: {
			globals: {
				Bun: "readonly",
			},
		},
		rules: {
			"import/no-nodejs-modules": "off",
		},
	},
	{
		// Asserts on `styles.css` as a file, because the decisions it pins are
		// stylesheet structure rather than component behaviour: which media
		// feature guards the touch-target rules, and whether "muted" is spelled
		// as a colour token or as an opacity. Reading the stylesheet is the whole
		// mechanism, and it never reaches the bundle.
		files: ["src/ui/panelA11y.test.ts"],
		rules: {
			"import/no-nodejs-modules": "off",
		},
	},
	globalIgnores([
		"node_modules",
		// Nested agent worktrees are separate checkouts; linting them here would
		// report the same files twice and fail on their own build artifacts.
		".claude",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
