/**
 * Static gate over the built `main.js`.
 *
 * Obsidian does not load a plugin as a module. It reads `main.js` and evaluates
 * it as a CommonJS function body, so the bundle runs in a context with no owning
 * script and no import map. Constructs a bundler happily emits can therefore
 * fail only at runtime, inside `onload`, where the sole user-visible symptom is
 * "Failed to load plugin".
 *
 * 0.1.0-alpha.3 shipped `await import("electron")`, which Chromium rejects with
 * `TypeError: Failed to resolve module specifier 'electron'`.
 *
 * Import detection runs through esbuild's parser rather than a regex: the
 * bundle is minified third-party-heavy output, and dependencies embed strings
 * like "set globalThis.File to `import('node:buffer').File`" in error messages.
 * A regex flags those; a parser sees them for what they are, plain text.
 *
 * Composition is checked separately, against the build's metafile, because the
 * byte count cannot see it: a large dependency creeping back in while something
 * else shrinks reads as no change at all.
 */
import { readFileSync, statSync } from "node:fs";
import process from "node:process";
import esbuild from "esbuild";

const BUNDLE = process.argv[2] ?? "main.js";

/** Module breakdown esbuild wrote beside the bundle. */
const METAFILE = `${BUNDLE}.meta.json`;

/**
 * Hard ceiling on the shipped bundle, in bytes.
 *
 * Obsidian evaluates `main.js` in full on every launch, phones included, so
 * weight here is start-up latency the user pays for on every single app open.
 * Nothing else in the suite notices it: a bundle that doubles in size still
 * parses, still loads, still passes every test.
 *
 * The number is anchored to measurement, not taste. Trimming pi-ai's provider
 * catalog down to the shipped slice (see {@link ../src/net/builtinCatalog.ts})
 * took the bundle from ~1.83 MiB to ~1.47 MiB. The ceiling sits at 1.65 MiB:
 * roughly 180 KiB of deliberate headroom, enough that ordinary feature work
 * does not trip the gate, while a regression that pulls the full catalog — or
 * anything else of that order — lands above the line and gets caught here
 * rather than on a user's phone.
 */
const MAX_BUNDLE_BYTES = Math.round(1.65 * 1024 * 1024);

/**
 * Dependencies removed on purpose, which no import may bring back.
 *
 * Each of these was reachable only transitively, so nothing in `src/` names it
 * and no test notices its return — the sole symptom is a bundle that quietly
 * grew again. Keyed by the `node_modules` path segment esbuild records, matched
 * as a substring so a nested or pnpm-style layout is caught too.
 */
const BANNED_MODULES = new Map([
	[
		"node_modules/@google/genai/",
		"270 KiB of unreachable code: the adapter behind it throws on any fetch that is not globalThis.fetch, and every request here passes one to reach Obsidian's requestUrl. It returns through a provider factory in src/net/builtinCatalog.ts — import neither googleProvider nor GOOGLE_MODELS (see issue #91).",
	],
]);

function formatSize(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * Every module that contributed bytes to the bundle, as `node_modules`-relative
 * paths, or undefined when no metafile sits beside it.
 */
function readBundleInputs() {
	let meta;
	try {
		meta = JSON.parse(readFileSync(METAFILE, "utf8"));
	} catch {
		return undefined;
	}
	const output = meta.outputs?.[BUNDLE];
	return output?.inputs ? Object.keys(output.inputs) : undefined;
}

/**
 * Import kinds that Obsidian's eval-based loader cannot satisfy.
 *
 * `require-call` is fine — the desktop shell injects a real `require`, and
 * esbuild leaves the externals (obsidian, node builtins) as require calls by
 * design. A dynamic `import()` of any kind is not: it needs a module context
 * that an eval'd function body does not have.
 */
const FORBIDDEN_IMPORT_KINDS = new Map([
	[
		"dynamic-import",
		"Obsidian eval's main.js, so import() has no module context to resolve against and throws TypeError at load time. Use the host-injected require instead.",
	],
	["import-statement", "A static ESM import survives only in an ESM output; this bundle is evaluated as CommonJS."],
	["import-rule", "CSS @import in the JS bundle indicates the wrong output format."],
]);

/**
 * Collects every specifier esbuild parses as an import, with its kind.
 *
 * The bundle is fed through stdin so the entry point itself is not intercepted
 * by the hook. Everything is marked external, so nothing is actually read from
 * disk; this is a parse, not a real build.
 */
async function collectImports(source) {
	const imports = [];
	await esbuild.build({
		stdin: { contents: source, resolveDir: process.cwd(), sourcefile: BUNDLE, loader: "js" },
		bundle: true,
		write: false,
		logLevel: "silent",
		platform: "node",
		format: "cjs",
		plugins: [
			{
				name: "import-collector",
				setup(build) {
					build.onResolve({ filter: /.*/ }, (args) => {
						imports.push({ kind: args.kind, path: args.path });
						return { path: args.path, external: true };
					});
				},
			},
		],
	});
	return imports;
}

/** Syntax-level checks that do not depend on import graph shape. */
const TEXT_CHECKS = [
	{
		name: "import.meta reference",
		pattern: /\bimport\s*\.\s*meta\b/g,
		why: "import.meta is a syntax error outside a module, which takes the whole plugin down at load time.",
	},
];

function positionOf(source, index) {
	const upto = source.slice(0, index);
	return `${upto.split("\n").length}:${index - (upto.lastIndexOf("\n") + 1) + 1}`;
}

let source;
let sizeInBytes;
try {
	source = readFileSync(BUNDLE, "utf8");
	// Measured off the artifact rather than the decoded string: the on-disk byte
	// count is what Obsidian actually reads at launch.
	sizeInBytes = statSync(BUNDLE).size;
} catch (error) {
	console.error(`check-bundle: cannot read ${BUNDLE}: ${error.message}`);
	console.error("Run `npm run build` first.");
	process.exit(1);
}

const failures = [];

let imports;
try {
	imports = await collectImports(source);
} catch (error) {
	// A parse failure is itself a fatal defect: Obsidian would hit the same
	// syntax error while evaluating the bundle.
	console.error(`check-bundle: ${BUNDLE} does not parse as JavaScript`);
	console.error(error.message);
	process.exit(1);
}

for (const entry of imports) {
	const why = FORBIDDEN_IMPORT_KINDS.get(entry.kind);
	if (why) {
		failures.push({ name: `${entry.kind} of "${entry.path}"`, why, at: "-" });
	}
}

for (const check of TEXT_CHECKS) {
	check.pattern.lastIndex = 0;
	for (const match of source.matchAll(check.pattern)) {
		failures.push({ name: check.name, why: check.why, at: positionOf(source, match.index) });
	}
}

// A bundle that exports nothing gives Obsidian no plugin class to construct,
// which fails identically to a syntax error from the user's point of view.
if (!/module\.exports\b/.test(source)) {
	failures.push({
		name: "missing CommonJS export",
		why: "Obsidian instantiates module.exports as the plugin class; without it the plugin cannot load.",
		at: "-",
	});
}

// Composition, from the metafile. Absent for a dev build, where the size and
// import checks above still apply; a production build always writes one.
const bundleInputs = readBundleInputs();
if (bundleInputs) {
	for (const [segment, why] of BANNED_MODULES) {
		const offenders = bundleInputs.filter((input) => input.includes(segment));
		if (offenders.length > 0) {
			failures.push({ name: `banned module in bundle: ${segment} (${offenders.length} file(s))`, why, at: "-" });
		}
	}
}

if (sizeInBytes > MAX_BUNDLE_BYTES) {
	failures.push({
		name: `bundle over size limit (${formatSize(sizeInBytes)} > ${formatSize(MAX_BUNDLE_BYTES)})`,
		why: `Every byte here is parsed on each Obsidian launch, on phones too. The usual cause is a newly imported module dragging in a large dependency; the known one is pi-ai's full provider catalog, which any import of "@earendil-works/pi-ai/providers/all" (or of a barrel that re-exports it) pulls in whole. Import the specific provider and models entrypoints instead, as src/net/builtinCatalog.ts does.`,
		at: "-",
	});
}

if (failures.length > 0) {
	console.error(`check-bundle: ${failures.length} problem(s) in ${BUNDLE}\n`);
	for (const failure of failures) {
		console.error(`  ✗ ${failure.name}${failure.at === "-" ? "" : ` at ${failure.at}`}`);
		console.error(`    ${failure.why}\n`);
	}
	process.exit(1);
}

const kinds = [...new Set(imports.map((entry) => entry.kind))].sort().join(", ");
const headroom = formatSize(MAX_BUNDLE_BYTES - sizeInBytes);
console.log(
	`check-bundle: ${BUNDLE} clean (${imports.length} imports, kinds: ${kinds || "none"}; ${formatSize(sizeInBytes)} of ${formatSize(MAX_BUNDLE_BYTES)}, ${headroom} headroom)`,
);
