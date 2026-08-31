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
		// Test infrastructure that emulates Obsidian's own prototype helpers.
		// Obsidian's `hide()`/`show()` assign `display` directly — that is the
		// behaviour being reproduced — so the rule that rightly steers plugin
		// code toward `setCssProps` is scoped off here, and only here.
		files: ["src/testing/obsidianDom.ts"],
		rules: {
			"obsidianmd/no-static-styles-assignment": "off",
		},
	},
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
		// The user-level skill directories live on the user's machine, outside
		// any vault, so reading them needs the node filesystem — desktop only.
		// The require call sits behind a lazy try/catch (see nodeHomeEnv.ts's
		// header) so a mobile bundle never reaches it; the builtin-module ban is
		// scoped off for that one file rather than opened up generally.
		//
		// The test is listed for the same reason, one step removed: it asserts
		// that the module degrades on a host serving no builtins, and the only
		// honest way to describe such a host is against real `node:fs`/`node:os`
		// on the desktop side of the comparison. A test file is not bundled into
		// `main.js`, so nothing here can reach a phone.
		files: ["src/skills/nodeHomeEnv.ts", "src/skills/nodeHomeEnv.test.ts"],
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
	{
		// Same mechanism as the panel a11y gate one block up: these tests read
		// sibling sources off disk to pin structural invariants (the verdict-line
		// class is only created in one file). The files never reach the bundle.
		files: ["src/ui/settings/effectLine.test.ts"],
		rules: {
			"import/no-nodejs-modules": "off",
		},
	},
	{
		// The SDK shims (issue #92) reproduce the two provider SDKs' HTTP surface
		// so the real packages stay out of the bundle. Their contract tests spin
		// a local node:http server to pin the wire shape, and deliberately
		// exercise raw fetch — the shims' whole job is to hand pi-ai's fetch-based
		// decoders a Response, so the Obsidian requestUrl indirection would test
		// nothing. The test file is never bundled into main.js, so none of this
		// reaches a phone; the runtime shim files never touch global fetch
		// themselves (the caller injects one).
		files: ["src/net/shims/*.ts"],
		languageOptions: {
			globals: {
				// First async-generator usage in the plugin; the browser-globals
				// preset predates the TS lib type landing in the globals list.
				AsyncGenerator: "readonly",
			},
		},
		rules: {
			"import/no-nodejs-modules": "off",
			"no-restricted-globals": "off",
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
