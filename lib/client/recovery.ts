import type { Message } from "../types";
/** Never present an optimistic question or streamed fragment as saved history. */
export function discardProvisionalTurn(
  messages: Message[],
  provisionalUserId: number,
): Message[] {
  return messages.filter(
    (message) =>
      message.id !== provisionalUserId && message.id !== provisionalUserId - 1,
  );
}
