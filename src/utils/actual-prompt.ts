/**
 * Brings `actual_prompt` in a dream's prompt JSON in line with its latest
 * render: sets it to the prompt the provider actually used (fal's
 * `actual_prompt`, when Krea prompt expansion rewrote it), or removes one left
 * from an earlier render. Returns the new prompt string, or undefined when
 * nothing changes or the dream's prompt is not a JSON object.
 */
export function withActualPrompt(prompt: unknown, actualPrompt: string | undefined): string | undefined {
  const params = parsePromptObject(prompt);
  if (!params || params.actual_prompt === actualPrompt) {
    return undefined;
  }
  return JSON.stringify({ ...params, actual_prompt: actualPrompt });
}

function parsePromptObject(prompt: unknown): Record<string, unknown> | undefined {
  let params: unknown = prompt;
  if (typeof prompt === 'string') {
    try {
      params = JSON.parse(prompt);
    } catch {
      return undefined;
    }
  }
  return isRecord(params) ? params : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
