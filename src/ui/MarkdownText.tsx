import React, { useEffect, useRef } from "react";
import { MarkdownRenderer, type App, type Component } from "obsidian";
import { resolveTextRenderMode, type TextBlockKind } from "./markdownPolicy";

export interface MarkdownTextProps {
	text: string;
	kind: TextBlockKind;
	/** True while the surrounding message is still streaming in. */
	isStreaming?: boolean;
	app: App;
	component: Component;
	/**
	 * Note path used to resolve `[[wikilinks]]` and relative image paths; empty
	 * when no note is active.
	 *
	 * Read at render time and deliberately not a re-render trigger — see
	 * {@link MarkdownContainer}.
	 */
	sourcePath: string;
}

/**
 * Renders one chat text block.
 *
 * Markdown blocks go through `MarkdownRenderer.render`, which is Obsidian's own
 * sanitizing pipeline — nothing here touches `innerHTML` directly, so model
 * output never reaches the DOM unescaped by us.
 *
 * Plain blocks keep the `<pre>` treatment (streaming text, tool arguments,
 * tool results).
 */
export function MarkdownText({ text, kind, isStreaming = false, app, component, sourcePath }: MarkdownTextProps): React.JSX.Element {
	if (resolveTextRenderMode(kind, isStreaming) === "plain") {
		return <pre className="piem-chat__text">{text}</pre>;
	}
	return <MarkdownContainer markdown={text} app={app} component={component} sourcePath={sourcePath} />;
}

/**
 * Thin DOM shell around `MarkdownRenderer.render`.
 *
 * The effect clears the container on every run because `render` appends to it:
 * without that, re-renders of an already-finished message would stack a second
 * copy of the content. The promise result is deliberately not awaited by React
 * state; appending happens inside Obsidian's renderer and cleanup only needs to
 * drop whatever landed.
 *
 * `sourcePath` is read through a ref rather than listed as a dependency. It is
 * only a link-resolution base, and re-rendering because it changed would mean
 * tearing down and re-rendering every block in the transcript through Obsidian's
 * renderer each time the user opened a different note. That used to be
 * unreachable — nothing re-rendered the panel on a note switch — but the context
 * chips subscribe to the workspace, so the switch now reaches React and the
 * dependency would fire on every one. Already-rendered content keeps the path
 * that was current when it rendered, which is the right base for the links it
 * actually contains.
 */
function MarkdownContainer({ markdown, app, component, sourcePath }: { markdown: string; app: App; component: Component; sourcePath: string }): React.JSX.Element {
	const ref = useRef<HTMLDivElement | null>(null);
	const sourcePathRef = useRef(sourcePath);

	sourcePathRef.current = sourcePath;

	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return undefined;
		}
		el.empty();
		void MarkdownRenderer.render(app, markdown, el, sourcePathRef.current, component).catch((error: unknown) => {
			console.error("piem: markdown render failed", error);
		});
		return () => {
			el.empty();
		};
	}, [app, component, markdown]);

	return <div className="piem-chat__markdown" ref={ref} />;
}
