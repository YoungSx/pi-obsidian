import { mock } from "bun:test";

/**
 * Registers the `obsidian` module stub used by every test.
 *
 * The `obsidian` package ships type declarations only — it contains no
 * JavaScript at all — so anything importing it at runtime must be mocked.
 *
 * `mock.module` is process-global and last-registration-wins, so a test file
 * that registers only the few exports it needs will silently break every other
 * file in the same run that expected a different subset. Test files therefore
 * share this single stub instead of declaring their own, and any export used by
 * production code belongs here.
 */
export function installObsidianStub(): void {
	void mock.module("obsidian", () => obsidianStub);
}

/** Mutable handle so a test can assert on or reconfigure `requestUrl`. */
export const requestUrlMock = mock<(params: unknown) => Promise<unknown>>();

/**
 * Mutable handle for the stubbed `Platform` flags.
 *
 * Tests that exercise desktop/mobile branching reconfigure these instead of
 * registering their own module mock, which would clobber the shared stub.
 */
export const platformMock = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isIosApp: false,
	isAndroidApp: false,
};

/** Arguments of the most recent `MarkdownRenderer.render` call. */
export interface MarkdownRenderCall {
	app: unknown;
	markdown: string;
	el: HTMLElement;
	sourcePath: string;
	component: unknown;
}

/** Mutable handle so a test can inspect or reconfigure `MarkdownRenderer.render`. */
export const markdownRenderMock = mock<(call: MarkdownRenderCall) => Promise<void>>();

/**
 * Records the call and, by default, appends a marker element so tests can
 * observe that something was rendered into `el`. Reconfigure via
 * `markdownRenderMock.mockImplementation(...)` to throw instead.
 */
markdownRenderMock.mockImplementation(async ({ el }: MarkdownRenderCall) => {
	const marker = (el.ownerDocument ?? globalThis.document)?.createElement("p");
	if (!marker) {
		return;
	}
	marker.className = "stub-rendered";
	el.appendChild(marker);
});

const obsidianStub = {
	MarkdownView: class MarkdownView {},
	ItemView: class ItemView {},
	MarkdownRenderer: {
		render: async (app: unknown, markdown: string, el: HTMLElement, sourcePath: string, component: unknown): Promise<void> =>
			await markdownRenderMock({ app, markdown, el, sourcePath, component }),
	},
	Plugin: class Plugin {},
	Modal: class Modal {},
	Menu: class Menu {
		addItem(): this {
			return this;
		}
		showAtMouseEvent(): void {}
		showAtPosition(): void {}
	},
	FuzzySuggestModal: class FuzzySuggestModal {},
	PluginSettingTab: class PluginSettingTab {},
	Setting: class Setting {},
	Notice: class Notice {},
	Scope: class Scope {},
	TFile: class TFile {},
	TFolder: class TFolder {},
	Platform: platformMock,
	requestUrl: async (params: unknown): Promise<unknown> => await requestUrlMock(params),
	setIcon: () => undefined,
};

/**
 * Controllable stand-in for Electron's `safeStorage`.
 *
 * Production code imports electron lazily, so tests exercise the desktop path
 * by injecting this mock into `createSecretEnvironment` directly rather than
 * registering a module-wide electron mock — one less global registration that
 * could clobber another file's expectations. Lives here with the obsidian stub
 * because it is the same kind of shared, per-test-reconfigurable handle.
 */
export class SafeStorageLikeMock {
	available = true;
	private readonly sealed = new Map<string, string>();
	encryptStringCalls = 0;
	decryptStringCalls = 0;

	isEncryptionAvailable(): boolean {
		return this.available;
	}

	encryptString(plainText: string): Buffer {
		this.encryptStringCalls += 1;
		if (!this.available) {
			throw new Error("encryption unavailable");
		}
		const token = `sealed:${this.sealed.size}:${plainText}`;
		this.sealed.set(token, plainText);
		return Buffer.from(token, "utf8");
	}

	decryptString(encrypted: Buffer): string {
		this.decryptStringCalls += 1;
		const token = encrypted.toString("utf8");
		const plain = this.sealed.get(token);
		if (plain === undefined) {
			throw new Error(`cannot decrypt: ${token.slice(0, 24)}`);
		}
		return plain;
	}
}
