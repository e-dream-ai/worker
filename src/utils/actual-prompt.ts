/**
 * Adds the prompt a provider actually used (fal's `actual_prompt`, set when
 * Krea prompt expansion rewrote it) to a dream's prompt JSON. Returns the new
 * prompt string, or undefined when the dream's prompt is not a JSON object.
 */
export function withActualPrompt(prompt: unknown, actualPrompt: string): string | undefined {
  let params: unknown = prompt;
  if (typeof prompt === 'string') {
    try {
      params = JSON.parse(prompt);
    } catch {
      return undefined;
    }
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return undefined;
  }
  return JSON.stringify({ ...params, actual_prompt: actualPrompt });
}
