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
	 * Note path used to resolve `[[wikilinks]]` and relative image paths;
	 * empty when no note is active. Computed once per app render so it does not
	 * churn on every message re-render.
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
 */
function MarkdownContainer({ markdown, app, component, sourcePath }: { markdown: string; app: App; component: Component; sourcePath: string }): React.JSX.Element {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return undefined;
		}
		el.empty();
		void MarkdownRenderer.render(app, markdown, el, sourcePath, component).catch((error: unknown) => {
			console.error("piem: markdown render failed", error);
		});
		return () => {
			el.empty();
		};
	}, [app, component, markdown, sourcePath]);

	return <div className="piem-chat__markdown" ref={ref} />;
}
