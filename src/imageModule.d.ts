/**
 * esbuild inlines any imported image as a data URI (loader map in
 * esbuild.config.mjs), so a consumer sees a plain string. Declared once here
 * rather than per-import; obsidian's package ships no image module types.
 */
declare module "*.png" {
	const dataUrl: string;
	export default dataUrl;
}
