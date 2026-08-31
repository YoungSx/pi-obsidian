/*
 * Renders the command menu's real CSS against the real markup, for eyeballing.
 *
 * Not a test and not shipped: `bun test` asserts on selectors and declarations,
 * which cannot answer "does the description actually ellipsize in a 300px
 * sidebar" — that is a question about layout, and only a layout engine answers
 * it. So this pulls the live rules out of `styles.css` rather than restating
 * them, hands them to Chromium beside the markup `CommandMenu.tsx` emits, and
 * measures the result. A copy of the CSS here would prove only that the copy
 * works.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const styles = readFileSync("styles.css", "utf8");

/*
 * Inside the repo, not `/tmp`: a snap-packaged Chromium — the build on most
 * Ubuntu machines — runs with a private `/tmp` and cannot see anything written
 * to the real one. `.preview/` is gitignored.
 *
 * `PREVIEW_DIR` is the escape hatch for a checkout the sandbox also refuses:
 * snap confinement covers non-hidden paths under `$HOME`, so a worktree under a
 * dotted directory (`~/.paseo/...`, as agent worktrees are) needs the page
 * regenerated somewhere else. `measure-command-menu.mjs` says so when it hits it.
 */
const OUT_DIR = process.env.PREVIEW_DIR ?? ".preview";
const OUT_FILE = `${OUT_DIR}/command-menu.html`;

/**
 * Every rule whose selector mentions the command menu, base cascade only.
 *
 * The media blocks are dropped rather than kept: hoisting a `(any-pointer:
 * coarse)` rule out of its query would apply the 48px touch floor on a desktop
 * screenshot, which is the one thing that would make this harness lie about the
 * layout it exists to show.
 */
function extractRules(source) {
	let base = "";
	let mediaDepth = 0;
	let inMedia = false;
	for (let i = 0; i < source.length; i += 1) {
		const char = source[i];
		if (!inMedia && source.startsWith("@media", i)) {
			inMedia = true;
			mediaDepth = 0;
		}
		if (!inMedia) {
			base += char;
			continue;
		}
		if (char === "{") {
			mediaDepth += 1;
		} else if (char === "}") {
			mediaDepth -= 1;
			// The query's own closing brace: back to the base cascade.
			if (mediaDepth === 0) {
				inMedia = false;
			}
		}
	}
	// Comments carry braceless prose, so they are stripped before the selector
	// match — otherwise a comment mentioning the menu would be read as one.
	const withoutComments = base.replace(/\/\*[\s\S]*?\*\//g, "");
	/*
	 * Every rule, then filter — rather than one regex that matches only the
	 * interesting selectors. A pattern anchored on the previous rule's `}`
	 * consumes that brace, leaving the next rule with no anchor, so it silently
	 * returns every *other* matching rule: the first cut of this script dropped
	 * `-kind` and the `aria-selected` highlight that way and still rendered
	 * something plausible enough to screenshot.
	 */
	const rules = [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
	return rules
		.filter(([, selector]) => selector.includes("command-menu"))
		.map(([, selector, body]) => `${selector.trim()} {${body}}`)
		.join("\n");
}

const rules = extractRules(styles);
/*
 * Name every rule the screenshot depends on, not just one of them. The loose
 * version of this guard (`includes("command-menu-desc")`) passed while the
 * extractor was dropping alternate rules, which is exactly the failure a
 * harness must not be able to have: a picture with the trailing column's
 * `margin-left: auto` missing looks like a design decision, not a bug.
 */
for (const required of [
	".piem-chat__command-menu ",
	"command-menu-item ",
	"command-menu-button ",
	"command-menu-name ",
	"command-menu-desc ",
	"command-menu-kind ",
	'aria-selected="true"',
]) {
	if (!rules.includes(required)) {
		throw new Error(`extraction missed ${required}; the harness would render a different layout than the plugin`);
	}
}

/** One row, exactly as CommandMenu.tsx emits it. */
function row({ name, description, kind, selected }) {
	return `<li class="piem-chat__command-menu-item" role="option" aria-selected="${selected ? "true" : "false"}">
	<button type="button" class="piem-chat__command-menu-button" tabindex="-1">
		<span class="piem-chat__command-menu-name">/${name}</span>
		${description ? `<span class="piem-chat__command-menu-desc">${description}</span>` : ""}
		<span class="piem-chat__command-menu-kind">${kind}</span>
	</button>
</li>`;
}

const ROWS = [
	{ name: "summarize", description: "Summarize the active note", kind: "Skill", selected: true },
	{ name: "echo", description: "Echo the arguments", kind: "Prompt" },
	{ name: "translate", description: "Translate the active note into the vault's language, preserving front matter and wikilinks", kind: "Prompt" },
	{ name: "bare", description: "", kind: "Prompt" },
	{ name: "tag-organize", description: "Organize tags", kind: "Skill" },
	{ name: "an-extremely-long-skill-name-that-should-not-exist", description: "Pathological", kind: "Skill" },
];

/*
 * Obsidian's own defaults for the tokens these rules read. Values, not guesses:
 * the 4pt scale and the two UI font sizes are what `app.css` ships.
 */
const TOKENS = `
	--size-4-1: 4px;
	--size-4-2: 8px;
	--size-4-12: 48px;
	--radius-s: 4px;
	--radius-m: 8px;
	--font-ui-small: 13px;
	--font-ui-smaller: 12px;
	--font-medium: 500;
	--font-interface: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	--background-primary: #1e1e1e;
	--background-modifier-border: #3f3f3f;
	--background-modifier-hover: rgba(255, 255, 255, 0.075);
	--text-normal: #dcddde;
	--text-muted: #b3b3b3;
	--shadow-s: 0 1px 2px rgba(0, 0, 0, 0.5);
	--layer-menu: 65;
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {${TOKENS}}
body { background: #262626; color: var(--text-normal); font-family: var(--font-interface); margin: 0; padding: 16px; display: flex; gap: 24px; align-items: flex-start; }
.panel { position: relative; }
.panel h3 { color: #888; font-size: 11px; font-weight: 400; margin: 0 0 6px; }
.shell { position: relative; height: 60px; }
${rules}
/* Static, so the menu sits in flow for the screenshot instead of floating off it. */
.piem-chat__command-menu { position: static; bottom: auto; }
</style></head><body>
<div class="panel" style="width: 300px"><h3>300px — phone / narrow sidebar</h3>
	<ul class="piem-chat__command-menu" role="listbox">${ROWS.map(row).join("")}</ul>
</div>
<div class="panel" style="width: 520px"><h3>520px — wide sidebar</h3>
	<ul class="piem-chat__command-menu" role="listbox">${ROWS.map(row).join("")}</ul>
</div>
<pre id="results" style="display: none"></pre>
<script>
/*
 * Measures what the engine actually produced. Inline rather than injected so a
 * plain \`--dump-dom\` run carries the numbers back out.
 */
const out = [];
for (const panel of document.querySelectorAll(".panel")) {
	const label = panel.querySelector("h3").textContent;
	for (const item of panel.querySelectorAll(".piem-chat__command-menu-item")) {
		const button = item.querySelector(".piem-chat__command-menu-button");
		const name = item.querySelector(".piem-chat__command-menu-name");
		const desc = item.querySelector(".piem-chat__command-menu-desc");
		const kind = item.querySelector(".piem-chat__command-menu-kind");
		const box = button.getBoundingClientRect();
		const style = getComputedStyle(button);
		const lineHeight = parseFloat(getComputedStyle(name).lineHeight) || 18;
		const contentHeight = box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
		/*
		 * Overflowing content is not the same as a painted ellipsis, and the first
		 * cut of this harness conflated them: \`scrollWidth > clientWidth\` says the
		 * content is wider than its box, which stays true when the box does not
		 * clip — the text simply spills across the trailing tag. Dropping
		 * \`overflow: hidden\` from the description therefore passed. So the report
		 * carries both halves, and the assertions demand the pair.
		 */
		const overflows = (el) => (el ? el.scrollWidth > el.clientWidth + 1 : false);
		const clips = (el) => (el ? getComputedStyle(el).overflowX !== "visible" : false);
		out.push({
			panel: label,
			name: name.textContent,
			height: Math.round(box.height),
			lines: Math.max(1, Math.round(contentHeight / lineHeight)),
			hasDesc: Boolean(desc),
			nameOverflows: overflows(name),
			descOverflows: overflows(desc),
			nameClips: clips(name),
			descClips: clips(desc),
			kindTrailingGap: Math.round(box.right - parseFloat(style.paddingRight) - kind.getBoundingClientRect().right),
			spansShareTheLine: [name, desc, kind]
				.filter(Boolean)
				.every((el) => el.getBoundingClientRect().top >= box.top - 0.5 && el.getBoundingClientRect().bottom <= box.bottom + 0.5),
		});
	}
}
document.getElementById("results").textContent = JSON.stringify(out);
</script>
</body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, html);
console.log(`wrote ${OUT_FILE}`);
