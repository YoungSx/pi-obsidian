export const PLUGIN_ID = "piem";
export const VIEW_TYPE_PIEM_CHAT = `${PLUGIN_ID}-chat-view`;
export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_MODEL_ID = "deepseek-v4-pro";
export const DEFAULT_THINKING_LEVEL = "high";
/**
 * Synthetic provider id behind user-configured OpenAI-compatible endpoints.
 * It is not part of the builtin catalog; API keys are looked up under it.
 */
export const CUSTOM_ENDPOINT_PROVIDER = "custom";

/**
 * Where the plugin's own source, tracker, and licence live.
 *
 * Spelled out rather than derived from a single base URL: GitHub's paths for
 * issues and blobs are its own conventions, and building them by concatenation
 * would break silently if any of them ever moves.
 */
export const REPOSITORY_URL = "https://github.com/YoungSx/pi-obsidian";
export const ISSUES_URL = "https://github.com/YoungSx/pi-obsidian/issues";
export const LICENSE_URL = "https://github.com/YoungSx/pi-obsidian/blob/master/LICENSE";

/** Where the author's coffee money goes. */
export const KO_FI_URL = "https://ko-fi.com/shangxin";
