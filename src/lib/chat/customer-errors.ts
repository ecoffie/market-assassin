/**
 * Customer-facing Ask Mindy failure messages (B2).
 *
 * Provider error bodies (status codes, model names, quota text, request ids, stack traces)
 * belong in recordProviderEvent / server logs, never in the chat bubble. Every failure the
 * customer can see comes from this fixed table, so no provider text can reach them by
 * construction: callers pass a KIND, never an error object or string.
 */
export type ChatFailureKind =
  | 'answer_unavailable'   // every answer model failed or was blocked
  | 'stream_failed'        // unexpected exception while streaming
  | 'connection_failed'    // client could not reach /api/app/chat
  | 'service_unavailable'; // non-2xx from /api/app/chat that is not a known gate

const MESSAGES: Record<ChatFailureKind, string> = {
  answer_unavailable: "Mindy couldn't answer right now. Nothing was wrong with your question. Please try again in a moment.",
  stream_failed: 'Something went wrong while Mindy was answering, so this answer is incomplete. Please try again.',
  connection_failed: "Couldn't reach Mindy. Check your connection and try again.",
  service_unavailable: 'Mindy is temporarily unavailable. Please try again in a moment.',
};

export function customerErrorMessage(kind: ChatFailureKind): string {
  return MESSAGES[kind];
}

/** Every customer-facing failure string, for tests that assert nothing else is ever shown. */
export const CUSTOMER_ERROR_MESSAGES: readonly string[] = Object.values(MESSAGES);
