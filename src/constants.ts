export const PLUGIN_ID = "pi-obsidian";
export const VIEW_TYPE_PI_CHAT = `${PLUGIN_ID}-chat-view`;
export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_MODEL_ID = "deepseek-v4-pro";
export const DEFAULT_THINKING_LEVEL = "high";
/**
 * Synthetic provider id behind user-configured OpenAI-compatible endpoints.
 * It is not part of the builtin catalog; API keys are looked up under it.
 */
export const CUSTOM_ENDPOINT_PROVIDER = "custom";
