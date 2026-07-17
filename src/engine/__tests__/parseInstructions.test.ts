import { describe, it, expect } from 'vitest';
import { parseInstructions, timecodeToSeconds } from '../parseInstructions';

describe('timecodeToSeconds', () => {
  it('parses MM:SS', () => {
    expect(timecodeToSeconds('00:56')).toBe(56);
    expect(timecodeToSeconds('01:40')).toBe(100);
  });
  it('parses HH:MM:SS', () => {
    expect(timecodeToSeconds('01:02:03')).toBe(3723);
  });
  it('parses fractional and comma decimals', () => {
    expect(timecodeToSeconds('00:01.5')).toBe(1.5);
    expect(timecodeToSeconds('00:01,5')).toBe(1.5);
  });
  it('parses bare seconds with unit', () => {
    expect(timecodeToSeconds('56s')).toBe(56);
    expect(timecodeToSeconds('90 seconds')).toBe(90);
  });
});

describe('parseInstructions', () => {
  it('parses explicit ranges', () => {
    const r = parseInstructions('visual 1: 00:00 - 00:56\nvisual 2: 00:56 - 01:03');
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ visualNumber: 1, start: 0, end: 56 });
    expect(r[1]).toMatchObject({ visualNumber: 2, start: 56, end: 63 });
  });

  it('handles the user\'s "till" phrasing (end-only)', () => {
    const text = [
      'virtual one is from 00:00 to 00:56',
      'virtual two is till 01:03',
      'virtual 3 is till 01:40',
    ].join('\n');
    const r = parseInstructions(text);
    expect(r[0]).toMatchObject({ visualNumber: 1, start: 0, end: 56 });
    expect(r[1]).toMatchObject({ visualNumber: 2, end: 63 });
    expect(r[1].start).toBeUndefined();
    expect(r[2]).toMatchObject({ visualNumber: 3, end: 100 });
  });

  it('parses worded visual numbers', () => {
    const r = parseInstructions('virtual three till 01:40');
    expect(r[0].visualNumber).toBe(3);
  });

  it('auto-numbers lines without an explicit visual reference', () => {
    const r = parseInstructions('00:00 - 00:10\n00:10 - 00:20');
    expect(r[0].visualNumber).toBe(1);
    expect(r[1].visualNumber).toBe(2);
  });

  it('parses enumerations like "4) 1:40 - 2:10"', () => {
    const r = parseInstructions('4) 1:40 - 2:10');
    expect(r[0]).toMatchObject({ visualNumber: 4, start: 100, end: 130 });
  });

  it('ignores lines without timecodes', () => {
    const r = parseInstructions('Here are the instructions:\nvisual 1: 0:00 - 0:05');
    expect(r).toHaveLength(1);
    expect(r[0].visualNumber).toBe(1);
  });

  it('splits multiple instructions packed on one line', () => {
    const r = parseInstructions('visual 1 from 0:00 to 0:05, visual 2 till 0:12');
    expect(r).toHaveLength(2);
    expect(r[0].visualNumber).toBe(1);
    expect(r[1].visualNumber).toBe(2);
    expect(r[1].end).toBe(12);
  });
});
