import { describe, expect, it } from "bun:test";
import { DiscardGuard } from "./modalGuards";

/**
 * Pure state-machine tests: no DOM, no modal. The rule the whole kit promises
 * is "a dirty form closes only on the second press, a clean or earned one
 * closes on the first, and fresh typing re-arms the warning" — each test pins
 * one leg of that promise against a counted warn callback.
 */
describe("DiscardGuard", () => {
	it("a clean form closes without warning", () => {
		const warnings: number[] = [];
		const guard = new DiscardGuard(() => warnings.push(1));
		expect(guard.shouldClose(false)).toBe(true);
		expect(warnings).toHaveLength(0);
	});

	it("a dirty form warns once and stays, then closes on the second press", () => {
		const warnings: number[] = [];
		const guard = new DiscardGuard(() => warnings.push(1));
		expect(guard.shouldClose(true)).toBe(false);
		expect(warnings).toHaveLength(1);
		expect(guard.shouldClose(true)).toBe(true);
		expect(warnings).toHaveLength(1);
	});

	it("editing after the warning re-arms it — the new draft owes a new look", () => {
		const warnings: number[] = [];
		const guard = new DiscardGuard(() => warnings.push(1));
		guard.shouldClose(true);
		guard.edited();
		expect(guard.shouldClose(true)).toBe(false);
		expect(warnings).toHaveLength(2);
	});

	it("an earned close goes through even while dirty", () => {
		const warnings: number[] = [];
		const guard = new DiscardGuard(() => warnings.push(1));
		guard.allowClose();
		expect(guard.shouldClose(true)).toBe(true);
		expect(warnings).toHaveLength(0);
	});
});
