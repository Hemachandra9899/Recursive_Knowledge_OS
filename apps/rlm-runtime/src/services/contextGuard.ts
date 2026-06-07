export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function isContextTooLarge(
  messages: Array<{ content: string }>,
  maxTokens: number
): boolean {
  const total = messages.reduce(
    (sum, message) => sum + estimateTokens(message.content),
    0
  );
  return total > maxTokens;
}

export function contextLimitMessage(maxTokens: number): string {
  return [
    `This chat is getting too large for the current context limit of about ${maxTokens} tokens.`,
    "",
    "Please start a new chat or narrow the request so I can answer reliably.",
  ].join("\n");
}
