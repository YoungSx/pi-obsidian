import type { ImageContent } from "@earendil-works/pi-ai";
import { arrayBufferToBase64 } from "../vault/image";

/**
 * An image staged in the composer, awaiting the next send.
 *
 * Ephemeral by design: it lives only for the turn the user is composing and is
 * never persisted. The session log stores a placeholder instead (see
 * {@link sanitizeMessageForLog}), so the base64 must not reach a draft file or
 * a session JSONL — both are text and both outlive the image.
 */
export interface PendingImage {
	/** Stable id so React keys and remove-by-id stay unambiguous across reorders. */
	id: string;
	/** MIME type, forwarded to the model as `ImageContent.mimeType`. */
	mimeType: string;
	/** base64-encoded bytes, forwarded to the model as `ImageContent.data`. */
	data: string;
}

/**
 * Reads an image `File` (from a paste or drop event) into a {@link PendingImage}.
 *
 * Only files whose MIME type is an image are accepted; the caller filters first,
 * so this never receives a non-image. The `File` is a DOM type, but
 * `arrayBuffer()` is available on both the browser `File` and Bun's test shim,
 * keeping this unit-testable with a stub.
 */
export async function fileToPendingImage(file: File): Promise<PendingImage> {
	const buffer = await file.arrayBuffer();
	return {
		id: newPendingImageId(),
		mimeType: file.type,
		data: arrayBufferToBase64(buffer),
	};
}

/**
 * Converts staged images to the shape the agent's `prompt` overload accepts.
 *
 * A fresh array each call: the service may hold onto it for the run, and the
 * composer clears its stage on success, so aliasing the stage array would hand
 * the agent a list that empties underneath it.
 */
export function toImageContents(images: readonly PendingImage[]): ImageContent[] {
	return images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
}

/**
 * Ids a restaged image needs too: an edit's rewrite restages the original
 * turn's pictures (ChatApp), so the generator is shared rather than private.
 */
export function newPendingImageId(): string {
	return window.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
}
