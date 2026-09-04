/*
 * Renders the transcript's real CSS against the markup the chat panel emits, so
 * the overflow behaviour can be measured instead of reasoned about.
 *
 * Sibling of `preview-command-menu.mjs` and built the same way — the rules come
 * out of `styles.css` rather than being restated here, because a copy would only
 * prove the copy works. What differs is what gets extracted: the command menu's
 * harness drops every `@media`/`@container` block, since a coarse-pointer touch
 * floor would make a desktop screenshot lie. This one keeps them. The question
 * it exists to answer — "does a wide code block drag the column sideways on a
 * phone" — is a question *about* the narrow breakpoint, so dropping the
 * container queries would remove the very rules under test.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const styles = readFileSync("styles.css", "utf8");

/*
 * Inside the repo by default, never `/tmp`: a snap-packaged Chromium runs with a
 * private `/tmp` and cannot see anything written to the real one. `PREVIEW_DIR`
 * is the escape hatch for a checkout the sandbox also refuses — snap confinement
 * covers non-hidden paths under `$HOME`, so an agent worktree under `~/.paseo/…`
 * needs the page regenerated somewhere else. `measure-transcript.mjs` says so
 * when it hits that.
 */
const OUT_DIR = process.env.PREVIEW_DIR ?? ".preview";
const OUT_FILE = `${OUT_DIR}/transcript.html`;

/*
 * The whole stylesheet, minus the halves that would misrender this page.
 *
 * Extracting "every rule that mentions the transcript" the way the command-menu
 * harness does is wrong here: the bug under test is about *containment*, which is
 * a property of the ancestor chain — `.piem-chat` establishing the query
 * container, `.piem-chat__messages` owning the scroll. Filtering by selector
 * would drop whichever link in that chain happens not to match the pattern and
 * quietly change the layout being measured. So the file is used whole, and only
 * the settings half (which never renders inside a leaf) is left to be inert.
 */
const rules = styles;

/*
 * The guard covers the harness's *scaffolding*, not the behaviour under test —
 * and the distinction is what makes the measurement worth anything.
 *
 * The first cut of this listed `overflow-x: hidden` here. That inverted the whole
 * point: deleting the fix then failed at this line with "the harness would
 * measure a layout the plugin does not ship", so the one regression the harness
 * exists to catch was reported as the harness being broken, and the measurement
 * never ran. A guard must never assert what the assertions assert.
 *
 * What is left is what the page cannot render honestly without: the container
 * query the narrow-panel rules bind to, the scroll container itself, and the two
 * text faces the fixtures wear. Losing any of those means the harness is
 * measuring different markup than the plugin ships, which is a harness fault.
 */
for (const required of ["container-type: inline-size", ".piem-chat__messages {", ".piem-chat__markdown ", ".piem-chat__text {"]) {
	if (!rules.includes(required)) {
		throw new Error(`styles.css no longer carries ${required}; the harness would measure different markup than the plugin ships`);
	}
}

/*
 * Obsidian's own values for the tokens the stylesheet reads. Enough of them that
 * no declaration falls back to an initial value and changes the layout: an unset
 * `--size-4-2` would render every gap as `0` and hide a real overflow.
 */
const TOKENS = `
	--size-4-1: 4px;
	--size-4-2: 8px;
	--size-4-3: 12px;
	--size-4-4: 16px;
	--size-4-5: 20px;
	--size-4-6: 24px;
	--size-4-8: 32px;
	--size-4-9: 36px;
	--size-4-10: 40px;
	--size-4-12: 48px;
	--size-2-1: 2px;
	--size-2-2: 4px;
	--size-2-3: 6px;
	--radius-s: 4px;
	--radius-m: 8px;
	--radius-l: 12px;
	--font-ui-smaller: 12px;
	--font-ui-small: 13px;
	--font-ui-medium: 15px;
	--font-text-size: 16px;
	--font-semibold: 600;
	--font-medium: 500;
	--font-interface: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	--font-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
	--icon-s: 16px;
	--icon-size: 16px;
	--icon-color: #b3b3b3;
	--icon-color-hover: #dcddde;
	--icon-opacity: 0.85;
	--background-primary: #1e1e1e;
	--background-primary-alt: #161616;
	--background-secondary: #262626;
	--background-secondary-alt: #1a1a1a;
	--background-modifier-border: #3f3f3f;
	--background-modifier-border-hover: #555;
	--background-modifier-border-focus: #888;
	--background-modifier-hover: rgba(255, 255, 255, 0.075);
	--background-modifier-error: #a33;
	--background-modifier-error-rgb: 170, 51, 51;
	--background-modifier-success: #2a2;
	--text-normal: #dcddde;
	--text-muted: #b3b3b3;
	--text-faint: #6e6e6e;
	--text-error: #e55;
	--text-accent: #a882ff;
	--text-on-accent: #fff;
	--text-success: #2a2;
	--interactive-accent: #7c3aed;
	--interactive-accent-hover: #6d28d9;
	--interactive-normal: #2a2a2a;
	--interactive-hover: #333;
	--code-background: #2a2a2a;
	--pre-background: #2a2a2a;
	--code-size: 0.9em;
	--tag-background: #333;
	--shadow-s: 0 1px 2px rgba(0, 0, 0, 0.5);
	--shadow-l: 0 4px 12px rgba(0, 0, 0, 0.5);
	--layer-menu: 65;
	--scrollbar-thumb-bg: #555;
`;

/*
 * What `MarkdownRenderer.render` emits for each construct that can be wider than
 * a phone panel. Written as HTML rather than Markdown because the renderer is
 * Obsidian's and cannot run here; these are its documented outputs — a fenced
 * block as `<pre><code>`, a table as `<table>` (optionally inside Obsidian's own
 * `.table-wrapper`), math as `.math-block`.
 *
 * Every fixture is pathological on purpose. A construct that merely *might*
 * overflow proves nothing: the point is to hold the panel to a case that has no
 * line-break opportunity at all, because that is the case `pre-wrap` and
 * `word-wrap` silently fail.
 */
const LONG_PATH = "/Users/someone/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyVault/attachments/2026-09-01-screenshot-of-the-settings-pane.png";
const LONG_TOKEN = "a".repeat(96);

const MARKDOWN_CASES = {
	"long-url": `<p>See <a href="#">https://example.com/very/long/path/segment-that-never-breaks-anywhere?query=${LONG_TOKEN}</a> for details.</p>`,
	"inline-code": `<p>Run <code>bun test --filter ${LONG_TOKEN}</code> and check the output.</p>`,
	"fenced-code": `<pre><code>const value = "${LONG_TOKEN}";\nshort();\n</code></pre>`,
	"table-bare": `<table><thead><tr><th>path</th><th>lines</th><th>symbol</th><th>kind</th><th>owner</th></tr></thead><tbody><tr><td>src/ui/MessageList.tsx</td><td>812</td><td>MessageRow</td><td>function</td><td>ui</td></tr></tbody></table>`,
	"table-wrapped": `<div class="table-wrapper"><table><thead><tr><th>path</th><th>lines</th><th>symbol</th><th>kind</th><th>owner</th></tr></thead><tbody><tr><td>src/ui/MessageList.tsx</td><td>812</td><td>MessageRow</td><td>function</td><td>ui</td></tr></tbody></table></div>`,
	"wide-image": `<p><img alt="" width="1400" height="320" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1400' height='320'%3E%3Crect width='1400' height='320' fill='%23444'/%3E%3C/svg%3E"></p>`,
	"blockquote": `<blockquote><p>${LONG_TOKEN}</p></blockquote>`,
	"heading": `<h2>${LONG_TOKEN}</h2>`,
	"list-path": `<ul><li>${LONG_PATH}</li><li>short</li></ul>`,
	"math-block": `<div class="math math-block"><span style="white-space: nowrap">x = ${LONG_TOKEN}</span></div>`,
};

/** A conversational row, exactly as `MessageList.tsx` nests it. */
function messageRow(role, name, inner) {
	return `<article class="piem-chat__message piem-chat__message--${role}" data-case="${role}/${name}" aria-label="${role}">
	<div class="piem-chat__bubble">
		<div class="piem-chat__message-content">${inner}</div>
	</div>
</article>`;
}

/** The rendered-Markdown face. */
function markdownBlock(html) {
	return `<div class="piem-chat__markdown piem-chat__text--prose">${html}</div>`;
}

/** The plain `<pre>` face, used for streaming prose and machine output. */
function plainBlock(face, text) {
	return `<pre class="piem-chat__text piem-chat__text--${face}">${text}</pre>`;
}

/**
 * A trace row. The `call` variant is the one with no bounded body, which is why
 * it is included: the `result` and `harness` variants bound their own height and
 * so were already scroll containers, while a flat call row had nothing holding
 * its detail span to the panel's width.
 */
function traceRow(variant, name, detail, body) {
	const summary = `<summary class="piem-chat__trace-summary">
		<span class="piem-chat__trace-name piem-chat__trace-name--identifier">read_note</span>
		<span class="piem-chat__trace-detail">${detail}</span>
	</summary>`;
	if (!body) {
		return `<div class="piem-chat__trace piem-chat__trace--${variant} piem-chat__trace--flat" data-case="trace-${variant}/${name}">
		<span class="piem-chat__trace-name piem-chat__trace-name--identifier">read_note</span>
		<span class="piem-chat__trace-detail">${detail}</span>
	</div>`;
	}
	return `<details class="piem-chat__trace piem-chat__trace--${variant}" data-case="trace-${variant}/${name}" open>${summary}
	<div class="piem-chat__trace-body"><pre>${body}</pre></div>
</details>`;
}

const rows = [];
for (const [name, html] of Object.entries(MARKDOWN_CASES)) {
	rows.push(messageRow("assistant", name, markdownBlock(html)));
	rows.push(messageRow("user", name, markdownBlock(html)));
}
// The plain face, both typefaces: prose is the streaming branch, machine is tool
// output — and only the second has columns worth scrolling for.
rows.push(messageRow("assistant", "plain-machine", plainBlock("machine", `path\tlines\n${LONG_PATH}\t812`)));
rows.push(messageRow("assistant", "plain-prose", plainBlock("prose", `Reading ${LONG_PATH} now`)));
// Trace rows: a bounded result, a bounded harness block, and the unbounded call.
rows.push(traceRow("result", "long-output", LONG_PATH, `${LONG_PATH}\n${LONG_TOKEN}`));
rows.push(traceRow("harness", "wide-columns", LONG_PATH, `col_a\tcol_b\n${LONG_PATH}\t1`));
rows.push(traceRow("call", "flat", LONG_PATH, ""));
/*
 * The question card, both lives.
 *
 * It is a new construct in this column and the only interactive one: an option label
 * and its description are model-written text, so they are exactly the kind of content
 * that arrives unbreakable. A row that pushed the column open instead of wrapping
 * would drag the whole transcript sideways, which is the invariant this page holds.
 * The pathological label and the long path are the cases `pre-wrap` and `word-wrap`
 * silently fail on.
 */
rows.push(`<section class="piem-ask-card piem-ask-card--pending" data-case="ask-card/pending" aria-label="Question from Piem" tabindex="-1">
	<div class="piem-ask-card__state" role="status">
		<span class="piem-icon piem-ask-card__state-icon"></span>
		<span class="piem-ask-card__state-text">Piem needs your call</span>
	</div>
	<div class="piem-ask">
		<div class="piem-ask-question">
			<div class="piem-ask-question-text" id="ask-q0">Which of these should the merged note keep? ${LONG_TOKEN}</div>
			<div class="piem-ask-options" role="group" aria-labelledby="ask-q0" aria-label="What to keep" data-select="one">
				<button type="button" class="piem-ask-option" aria-pressed="false">
					<span class="piem-ask-option-marker" aria-hidden="true"></span>
					<span class="piem-ask-option-body">
						<span class="piem-ask-option-label">${LONG_PATH}</span>
						<span class="piem-ask-option-description">${LONG_TOKEN}</span>
					</span>
				</button>
				<button type="button" class="piem-ask-option" aria-pressed="true">
					<span class="piem-ask-option-marker" aria-hidden="true"></span>
					<span class="piem-ask-option-body"><span class="piem-ask-option-label">Keep both</span></span>
				</button>
				<label class="piem-ask-other-row">
					<span class="piem-ask-option-marker" aria-hidden="true"></span>
					<input type="text" class="piem-ask-other" placeholder="Something else…" aria-label="Your own answer for: What to keep">
				</label>
			</div>
		</div>
		<div class="piem-ask-footer">
			<span class="piem-ask-remaining"></span>
			<button type="button" class="piem-ask-dismiss">Let Piem decide</button>
			<button type="button" class="piem-ask-confirm mod-cta" disabled>Confirm</button>
		</div>
	</div>
</section>`);
rows.push(`<section class="piem-ask-card piem-ask-card--answered" data-case="ask-card/answered" aria-label="Question from Piem">
	<div class="piem-ask-card__state">
		<span class="piem-icon piem-ask-card__state-icon"></span>
		<span class="piem-ask-card__state-text">You answered</span>
	</div>
	<dl class="piem-ask-card__record">
		<div class="piem-ask-card__pair">
			<dt class="piem-ask-card__question">Which of these should the merged note keep? ${LONG_TOKEN}</dt>
			<dd class="piem-ask-card__answer"><span class="piem-ask-card__picked">${LONG_PATH}</span></dd>
		</div>
	</dl>
</section>`);
// The compaction divider, whose `max-height` already made it a scroller.
rows.push(`<section class="piem-chat__compaction" data-case="compaction/long">
	<div class="piem-chat__compaction-heading">Earlier turns were summarized</div>
	<pre>${LONG_PATH} ${LONG_TOKEN}</pre>
</section>`);

/*
 * Three panels, each a real leaf.
 *
 * The 390px one is the phone the issue was filed against. The 300px one is the
 * default desktop right sidebar, which is *narrower* and so the harder case —
 * and the reason the `@container` blocks are kept: at 300px and 390px the
 * narrow-leaf rules fire, at 560px they do not, so the middle column is where a
 * fix that only works below the breakpoint would show up.
 *
 * `contain: strict` and `isolation: isolate` mirror what `app.css` puts on
 * `.workspace-leaf`; without them the panel would be free to grow into the page
 * and every measurement would read zero overflow.
 */
function panel(label, width) {
	return `<div class="harness-panel">
	<h3>${label}</h3>
	<div class="harness-leaf" style="width: ${width}px" data-panel="${label}" data-width="${width}">
		<div class="view-content piem-chat-view">
			<div class="piem-chat">
				<div class="piem-chat__transcript">
					<div class="piem-chat__messages" tabindex="0">${rows.join("\n")}</div>
				</div>
			</div>
		</div>
	</div>
</div>`;
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>piem transcript overflow</title><style>
:root {${TOKENS}}
body { background: #111; color: var(--text-normal); font-family: var(--font-interface); margin: 0; padding: 16px; display: flex; gap: 20px; align-items: flex-start; }
.harness-panel h3 { color: #888; font-size: 11px; font-weight: 400; margin: 0 0 6px; }
/* The leaf, as app.css builds it: a fixed-width containment and stacking box. */
.harness-leaf { background: var(--background-secondary); contain: strict; isolation: isolate; height: 620px; }
.view-content { height: 100%; width: 100%; }
/*
 * Obsidian's own form-control rule, reproduced so the element-qualified resets in
 * styles.css have the thing they exist to outrank. The question card's rows are
 * buttons, and without this the page would measure a layout the plugin never
 * produces — and would pass while the reset was broken. No backticks in this
 * comment: it lives inside the page template literal and one would close it.
 */
button:not(.clickable-icon) { background: var(--interactive-normal, #2a2a2a); border: none; color: var(--text-normal); font-family: inherit; font-size: var(--font-ui-small); height: 30px; padding: 0 12px; text-align: center; white-space: nowrap; }
${rules}
</style></head><body>
${panel("300px sidebar", 300)}
${panel("390px phone", 390)}
${panel("560px wide leaf", 560)}
<pre id="results" style="display: none"></pre>
<script>
/*
 * Measures what the engine produced, inline so a plain \`--dump-dom\` run carries
 * the numbers back out.
 *
 * The verdict is deliberately not "is any element wider than the panel". A table
 * inside its own horizontally scrollable box is *supposed* to be wider than the
 * panel — that is the fix, not the bug. Two separate questions are asked instead:
 *
 *   1. Does the transcript itself scroll sideways? It must never, on any width.
 *      This is the user-visible symptom the issue reports.
 *   2. Does any element push a box that absorbs nothing? Walking up from each
 *      element to the first ancestor with \`overflow-x: auto|scroll\` answers it —
 *      content inside such an ancestor is contained by design, content that
 *      reaches the transcript without meeting one is a leak.
 *
 * Clipping alone is not containment, and the distinction is the whole point:
 * \`overflow-x: hidden\` on the transcript would make symptom 1 disappear while
 * silently truncating a wide table to whatever fits. So \`hidden\` does not count
 * as absorbing in check 2 — only a scrollable ancestor does, because only that
 * one leaves the content reachable.
 */
const out = [];
for (const leaf of document.querySelectorAll(".harness-leaf")) {
	const label = leaf.dataset.panel;
	const msgs = leaf.querySelector(".piem-chat__messages");
	const scrollsX = (el) => { const ox = getComputedStyle(el).overflowX; return ox === "auto" || ox === "scroll"; };
	const clipsX = (el) => scrollsX(el) || getComputedStyle(el).overflowX === "hidden";

	// Which direct children set the transcript's scrollWidth — the ones to blame.
	const pushers = [...msgs.children]
		.filter((el) => el.scrollWidth > msgs.clientWidth + 1)
		.map((el) => ({ case: el.dataset.case ?? el.className, scrollWidth: el.scrollWidth }));

	const leaks = [];
	const contained = [];
	for (const el of msgs.querySelectorAll("*")) {
		let host = null;
		for (let p = el.parentElement; p; p = p.parentElement) {
			if (clipsX(p)) { host = p; break; }
		}
		host = host ?? document.documentElement;
		const over = Math.round(el.getBoundingClientRect().right - host.getBoundingClientRect().right);
		// Contained when something between this element and the transcript scrolls.
		let absorbed = false;
		for (let p = el.parentElement; p && p !== msgs; p = p.parentElement) {
			if (scrollsX(p)) { absorbed = true; break; }
		}
		const row = el.closest("[data-case]");
		const id = { case: row ? row.dataset.case : "(none)", tag: el.tagName.toLowerCase(), cls: el.className || "" };
		if (over > 1 && !scrollsX(el) && !absorbed) {
			leaks.push({ ...id, pushesBy: over });
		}
		if (scrollsX(el) && el.scrollWidth > el.clientWidth + 1) {
			contained.push({ ...id, inner: el.scrollWidth, box: el.clientWidth });
		}
	}
	/*
	 * Whether a wide block's own scrollbar is reachable, i.e. whether the block's
	 * right edge is inside the column. A scroll box that starts beyond the panel's
	 * edge is a scrollbar nobody can grab.
	 */
	const reachable = [];
	for (const el of msgs.querySelectorAll("*")) {
		if (!scrollsX(el) || el.scrollWidth <= el.clientWidth + 1) continue;
		const r = el.getBoundingClientRect(), m = msgs.getBoundingClientRect();
		const row = el.closest("[data-case]");
		reachable.push({ case: row ? row.dataset.case : "(none)", tag: el.tagName.toLowerCase(),
			rightInside: Math.round(m.right - r.right) >= -1, overhang: Math.round(r.right - m.right) });
	}
	out.push({
		panel: label,
		reachable,
		width: Number(leaf.dataset.width),
		client: msgs.clientWidth,
		scrollWidth: msgs.scrollWidth,
		overflowX: getComputedStyle(msgs).overflowX,
		panelScrollsSideways: msgs.scrollWidth > msgs.clientWidth + 1,
		pushers,
		leaks,
		contained,
	});
}
document.getElementById("results").textContent = JSON.stringify(out);
</script>
</body></html>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, html);
console.log(`wrote ${OUT_FILE} — open it in a browser, or run: node scripts/measure-transcript.mjs`);
