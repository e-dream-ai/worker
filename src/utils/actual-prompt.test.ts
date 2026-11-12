import { describe, expect, test } from 'vitest';
import { withActualPrompt } from './actual-prompt.js';

describe('withActualPrompt', () => {
  test('adds actual_prompt to a prompt JSON string, keeping the other params', () => {
    const prompt = JSON.stringify({ infinidream_algorithm: 'krea-2-turbo', prompt: 'a cat', seed: 7 });
    expect(JSON.parse(withActualPrompt(prompt, 'a sleek tabby cat at dusk')!)).toEqual({
      infinidream_algorithm: 'krea-2-turbo',
      prompt: 'a cat',
      seed: 7,
      actual_prompt: 'a sleek tabby cat at dusk',
    });
  });

  test('accepts an already parsed prompt object', () => {
    expect(JSON.parse(withActualPrompt({ prompt: 'a cat' }, 'a tabby')!)).toEqual({
      prompt: 'a cat',
      actual_prompt: 'a tabby',
    });
  });

  test('replaces an earlier actual_prompt', () => {
    const prompt = JSON.stringify({ prompt: 'a cat', actual_prompt: 'old' });
    expect(JSON.parse(withActualPrompt(prompt, 'new')!).actual_prompt).toBe('new');
  });

  test.each([null, undefined, '', 'a bare prompt', '[1,2]', '"text"', 42])('leaves %j alone', (prompt) => {
    expect(withActualPrompt(prompt, 'a tabby')).toBeUndefined();
  });
});
