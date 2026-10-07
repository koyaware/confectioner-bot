import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { truncateText } from '../src/domain/truncate.js';

describe('truncateText', () => {
  it('keeps short text intact', () => {
    expect(truncateText('hello', 10)).toBe('hello');
    expect(truncateText('x'.repeat(1024), 1024)).toBe('x'.repeat(1024));
  });

  it('truncates with ellipsis and never splits emoji', () => {
    const out = truncateText(`a🍰${'b'.repeat(2000)}`, 1024);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('a🍰')).toBe(true);
  });

  it('property: output never exceeds max UTF-16 units', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 3000 }), fc.integer({ min: 1, max: 2000 }), (s, max) => {
        expect(truncateText(s, max).length).toBeLessThanOrEqual(max);
      })
    );
  });
});
