/**
 * Static gate over user-visible copy in the source tree.
 *
 * `src/i18n/en.ts` opens with a rule about itself: every string a human can see
 * lives in the copy tables, and nothing inlines English in a component. That
 * rule was a comment, and a comment is not a gate. Two branches have now broken
 * it without a single test objecting — the settings rework shipped five
 * hardcoded English settings, and `ContextRow.tsx` shipped six hardcoded
 * accessible names that survived the whole i18n effort.
 *
 * The ContextRow case is the one that argues for automation. Those six strings
 * were `aria-label`s, and an `aria-label` is invisible: the chips still rendered
 * their file names, the panel still looked fully translated, and every one of
 * the component's own tests passed, because they asserted the English. A
 * reviewer reading the diff would have had to know to go looking. The only
 * users who could see the defect were the ones reading the row through a screen
 * reader, in a language the row was not speaking.
 *
 * So this walks the AST rather than grepping. Copy reaches a user through a
 * small set of channels — a JSX attribute that names something, a text node, an
 * Obsidian setter, a `Notice` — and each one is a syntactic shape. A regex over
 * `aria-label="` finds the easy third of the ContextRow six and misses the
 * template literals and the conditional entirely; the parser sees all of them,
 * and is not fooled by a copy string that happens to mention an attribute name.
 *
 * It is a gate, not a proof. Someone determined to route a literal past it can:
 * a string handed through a helper, stored in a module constant, or read out of
 * a map is computed as far as this can tell, and passing it would be correct
 * behaviour rather than a hole, since the gate cannot know what a variable
 * holds. What it does cover is every shape reachable by writing the copy where
 * it is used — which is how both of the defects that motivated it were written.
 *
 * What counts as a violation is a *literal* in a copy position: a string, a
 * template, or a conditional/logical expression that yields one. Anything
 * computed — `t.t("...")`, a variable, a prop, a path off an object — passes,
 * because the gate cannot know what it holds and the translator lookup is
 * exactly the shape it is trying to encourage.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";
import ts from "typescript";

const ROOT = process.argv[2] ?? "src";

/**
 * JSX attributes whose value a person can read or hear.
 *
 * Deliberately not "every attribute": `className`, `role`, `type`, and
 * `aria-hidden` are all literal strings by nature, and flagging them would make
 * the gate noise that gets switched off. The list is the ARIA naming and
 * description properties plus the HTML attributes that surface as text.
 */
const COPY_ATTRIBUTES = new Set([
	"alt",
	"aria-description",
	"aria-label",
	"aria-placeholder",
	"aria-roledescription",
	"aria-valuetext",
	"label",
	"placeholder",
	"title",
]);

/**
 * Obsidian API calls that put a string in front of a user.
 *
 * `Setting.setName`/`setDesc` and friends are the settings-tab equivalent of a
 * JSX attribute, and `new Notice(...)` is the equivalent of rendering text.
 * `setAttribute` is absent on purpose: its literals are `role`, `tabindex`, and
 * `aria-selected`, none of which are copy.
 *
 * `setError`/`setNotice`/`appendNotice` are this project's own, and they were the
 * gate's blind spot: the panel's banner is the loudest copy surface in the plugin
 * and the only one nothing here was watching. Two English sentences reached a
 * Chinese UI through them and this check reported the tree clean. They are not
 * one of the "routed past it through a helper" escapes the header concedes — a
 * literal written directly into a call that renders it is exactly what this list
 * exists for; nobody had told the list about these three.
 */
const COPY_SETTERS = new Set([
	"appendNotice",
	"setButtonText",
	"setDesc",
	"setDescription",
	"setError",
	"setHeading",
	"setName",
	"setNotice",
	"setPlaceholder",
	"setTitle",
	"setTooltip",
]);

/**
 * Object-literal keys that carry copy into `createEl` and friends.
 *
 * `createEl("p", { text: "..." })` renders that text; `createEl("p")` names a
 * tag. Only the option object is inspected, so the tag name never trips the
 * gate.
 */
const COPY_OPTIONS = new Set(["placeholder", "text", "title"]);

/**
 * Literal copy this project has decided is correct as-is.
 *
 * One entry, and it should stay near one. "Piem" is the product's name, which is
 * the same word in every language a table could be written in — routing it
 * through the translator would invite someone to translate it, which is the
 * failure mode, not the fix.
 */
const ALLOWED_LITERALS = new Set(["Piem"]);

/** Files whose literals are not user-visible copy. */
function isExempt(file) {
	const parts = file.split(sep);
	// Tests assert on rendered copy, so their literals are the expectation
	// itself; a test that could not name the string it checks could not check it.
	if (/\.test\.tsx?$/.test(file)) {
		return true;
	}
	// The copy tables are where literals belong, and the test harness renders a
	// stub vault rather than a user's.
	return parts.includes("i18n") || parts.includes("testing");
}

/** Every `.ts`/`.tsx` file under a directory, recursively, sorted for stable output. */
function collectSources(dir, out = []) {
	for (const entry of readdirSync(dir).sort()) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			collectSources(path, out);
		} else if (/\.tsx?$/.test(path)) {
			out.push(path);
		}
	}
	return out;
}

/**
 * The literal text an expression will produce, or `null` when it is computed.
 *
 * `null` is the pass: a `t.t(...)` call, an identifier, a property access, or a
 * function call could hold anything, and guessing would either block the very
 * pattern this gate exists to encourage or invent violations that are not there.
 *
 * Conditionals and `||`/`??` chains recurse into both sides, because
 * `cond ? "Send" : "Stop"` is two hardcoded strings wearing one expression, and
 * that is precisely the shape `ContextRow.tsx:147` used to hide a pair of
 * accessible names from a `grep`. A branch that is computed makes the whole
 * expression computed: the literal side alone is not enough to conclude the
 * value is always literal, and reporting a half-computed expression would be a
 * false positive on code like `custom ?? t.t("fallback")`.
 */
function literalTextOf(node, source) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return node.text;
	}
	if (ts.isTemplateExpression(node)) {
		// Only the fixed spans matter. `${path}` is data — a vault path, a model
		// id — and the copy is whatever prose surrounds it.
		return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
	}
	// Wrappers that change a literal's type but not its text. `"Send" as const`
	// is a common narrowing idiom, and treating it as computed would let a
	// hardcoded string through for the price of three keywords.
	if (
		ts.isParenthesizedExpression(node) ||
		ts.isAsExpression(node) ||
		ts.isSatisfiesExpression(node) ||
		ts.isTypeAssertionExpression(node) ||
		ts.isNonNullExpression(node)
	) {
		return literalTextOf(node.expression, source);
	}
	if (ts.isConditionalExpression(node)) {
		return joinBranches(literalTextOf(node.whenTrue, source), literalTextOf(node.whenFalse, source));
	}
	if (ts.isBinaryExpression(node)) {
		const operator = node.operatorToken.kind;
		// `+` is the assembled-sentence case, and the most natural thing to reach
		// for once a template literal is known to be watched. `||`/`??` are the
		// fallback case. All three yield copy when every side does, so all three
		// recurse; a computed side makes the whole expression computed.
		if (
			operator === ts.SyntaxKind.PlusToken ||
			operator === ts.SyntaxKind.BarBarToken ||
			operator === ts.SyntaxKind.QuestionQuestionToken
		) {
			return joinBranches(literalTextOf(node.left, source), literalTextOf(node.right, source));
		}
	}
	// `["Connect a model", "to start"].join(" ")` is one sentence in two literals
	// with a method call between them. Only a literal array qualifies: joining a
	// computed array says nothing about what is in it.
	if (
		ts.isCallExpression(node) &&
		ts.isPropertyAccessExpression(node.expression) &&
		node.expression.name.getText(source) === "join" &&
		ts.isArrayLiteralExpression(node.expression.expression)
	) {
		const parts = node.expression.expression.elements.map((element) => literalTextOf(element, source));
		return parts.every((part) => part !== null) ? parts.join(" ") : null;
	}
	return null;
}

/** Both branches' text when both are literal, otherwise `null`. */
function joinBranches(left, right) {
	return left !== null && right !== null ? `${left} ${right}` : null;
}

/**
 * Whether a literal is copy a translator would need to own.
 *
 * The base test is a run of two or more letters. One letter is an axis label or
 * a shortcut key, and a bare number or symbol has no language. Non-Latin scripts
 * count too: Chinese hardcoded into a component is the same defect pointed the
 * other way.
 *
 * Two shapes are excluded because they are data that merely looks like words. A
 * single token carrying a file extension is a path (`title={"notes.md"}` names a
 * note, and translating it would break the link), and a lone token in
 * `kebab-case`, `snake_case`, or `dot.notation` is an identifier — a copy key, a
 * CSS class, a model id. Anything with a space in it is prose again, which is
 * what keeps this from excusing a real sentence.
 */
function isCopy(text) {
	const trimmed = text.trim();
	if (ALLOWED_LITERALS.has(trimmed)) {
		return false;
	}
	if (!/\p{L}{2,}/u.test(trimmed)) {
		return false;
	}
	if (!/\s/.test(trimmed) && /^[\w./-]+$/.test(trimmed) && /[._-]/.test(trimmed)) {
		return false;
	}
	return true;
}

/** Collects every literal-copy violation in one file. */
function inspect(file) {
	const text = readFileSync(file, "utf8");
	const source = ts.createSourceFile(
		file,
		text,
		ts.ScriptTarget.ESNext,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const violations = [];
	const at = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
	const report = (node, channel, literal) => {
		if (isCopy(literal)) {
			violations.push({ file, line: at(node), channel, literal: literal.trim().replace(/\s+/g, " ") });
		}
	};

	const visit = (node) => {
		if (ts.isJsxAttribute(node) && node.initializer) {
			const attribute = node.name.getText(source);
			const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
			if (COPY_ATTRIBUTES.has(attribute)) {
				const literal = value ? literalTextOf(value, source) : null;
				if (literal !== null) {
					report(node, `${attribute} attribute`, literal);
				}
			}
			// Rendered markup rather than a named value, so the literal lives one
			// level in, on `__html`. Copy is copy whichever way it reaches the DOM.
			if (attribute === "dangerouslySetInnerHTML" && value && ts.isObjectLiteralExpression(value)) {
				for (const property of value.properties) {
					if (ts.isPropertyAssignment(property) && property.name.getText(source) === "__html") {
						const literal = literalTextOf(property.initializer, source);
						if (literal !== null) {
							report(property, "dangerouslySetInnerHTML __html", literal);
						}
					}
				}
			}
		}

		if (ts.isJsxText(node)) {
			// JSX whitespace between elements parses as text; only prose counts.
			report(node, "JSX text", node.text);
		}

		if (ts.isCallExpression(node)) {
			const callee = ts.isPropertyAccessExpression(node.expression)
				? node.expression.name.getText(source)
				: node.expression.getText(source);
			if (COPY_SETTERS.has(callee)) {
				for (const argument of node.arguments) {
					const literal = literalTextOf(argument, source);
					if (literal !== null) {
						report(node, `${callee}() argument`, literal);
					}
				}
			}
			if (/^create(El|Span|Div|Fragment)$/.test(callee)) {
				for (const argument of node.arguments) {
					if (!ts.isObjectLiteralExpression(argument)) {
						continue;
					}
					for (const property of argument.properties) {
						if (!ts.isPropertyAssignment(property) || !COPY_OPTIONS.has(property.name.getText(source))) {
							continue;
						}
						const literal = literalTextOf(property.initializer, source);
						if (literal !== null) {
							report(property, `${callee}({ ${property.name.getText(source)} })`, literal);
						}
					}
				}
			}
		}

		if (ts.isNewExpression(node) && node.expression.getText(source) === "Notice") {
			const argument = node.arguments?.[0];
			const literal = argument ? literalTextOf(argument, source) : null;
			if (literal !== null) {
				report(node, "Notice() argument", literal);
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(source);
	return violations;
}

const files = collectSources(ROOT).filter((file) => !isExempt(file));
const violations = files.flatMap(inspect);

if (violations.length > 0) {
	console.error(`check-copy: ${violations.length} hardcoded string(s) in a user-visible position\n`);
	for (const violation of violations) {
		console.error(`  ✗ ${relative(process.cwd(), violation.file)}:${violation.line}  ${violation.channel}`);
		console.error(`    ${JSON.stringify(violation.literal)}\n`);
	}
	console.error(
		"Copy belongs in src/i18n/en.ts with a translation in zhCN.ts, read through the\n" +
			"translator: `const t = useT()` in a component, or the `Translator` a module is\n" +
			"handed. See the header of src/i18n/en.ts.\n",
	);
	process.exit(1);
}

console.log(`check-copy: ${files.length} files clean (no hardcoded copy in a user-visible position)`);
