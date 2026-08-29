/**
 * Why an assistant turn stopped before it finished saying something.
 *
 * Free of React and DOM imports so the rules and the wording can be unit-tested
 * without a renderer; `MessageList.tsx` owns the markup.
 *
 * The transcript has to distinguish "this reply is over" from "this reply ran
 * out", because the two look identical on screen: both end mid-thought with no
 * punctuation. Only one of them used to be reported. A user who pressed stop got
 * "You stopped this reply."; a reply the provider truncated at its output-token
 * limit got nothing at all, so the panel presented a half sentence as if the
 * model had chosen to end there.
 *
 * Both are the same fact from the reader's side — the words are incomplete — so
 * they resolve through one function rather than through a second `if` bolted
 * beside the first. That is what keeps the next reason pi adds (`stopReason` has
 * seven members) from being a third silent case.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Translator } from "../i18n";
import type { IconName } from "obsidian";

/** A reply that ended early, and why. `null` means it ended normally. */
export interface ReplyCutoff {
	/** Which cause, so the caller can pick copy and an icon without re-deriving it. */
	kind: "stopped" | "truncated";
	/** Line shown under the message. */
	notice: string;
	/**
	 * Same fact for a screen reader, appended to the spoken text.
	 *
	 * Lower case and phrased to continue a sentence: it is read as the tail of
	 * the reply ("…and then — you stopped this reply."), not as its own
	 * announcement.
	 */
	spoken: string;
	icon: IconName;
}

/**
 * Classifies how an assistant turn ended.
 *
 * `aborted` is the user pressing stop. `length` is the provider hitting the
 * output-token ceiling — pi treats it as significant enough to fail every tool
 * call in the message (`agent-loop.js`, `failToolCallsFromTruncatedMessage`,
 * whose comment notes that truncated arguments can still parse), so the text
 * beside those calls is no more trustworthy and the reader has to be told.
 *
 * Every other reason — `stop`, `toolUse`, `error`, `deferred`, `pending` —
 * returns `null`. A normal end needs no notice, and `error` already reaches the
 * user through the banner, which reads `errorMessage`. `length` is precisely the
 * reason that sets no `errorMessage`, which is how it stayed invisible.
 */
export function describeReplyCutoff(message: AssistantMessage, t: Translator): ReplyCutoff | null {
	if (message.stopReason === "aborted") {
		return {
			kind: "stopped",
			notice: t.t("chat.youStopped"),
			spoken: t.t("chat.youStoppedSpoken"),
			icon: "circle-slash",
		};
	}
	if (message.stopReason === "length") {
		return {
			kind: "truncated",
			notice: t.t("chat.replyTruncated"),
			spoken: t.t("chat.replyTruncatedSpoken"),
			icon: "scissors",
		};
	}
	return null;
}
