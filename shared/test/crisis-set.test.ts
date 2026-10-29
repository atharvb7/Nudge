import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectCrisis } from '../src';

// Parity with the backend: read the SAME labelled phrase set the Python
// classifier is tested against, so the on-device check can never drift behind.
const py = readFileSync(resolve(__dirname, '../../backend/tests/test_safety_set.py'), 'utf8');

function list(name: string): string[] {
  const start = py.indexOf(`${name} = [`);
  const end = py.indexOf('\n]', start);
  const block = py.slice(start, end);
  return Array.from(block.matchAll(/^\s*"((?:[^"\\]|\\.)*)",?\s*$/gm), (m) => JSON.parse(`"${m[1]}"`));
}

const POSITIVES = list('POSITIVES');
const NEGATIVES = list('NEGATIVES');

describe('crisis phrase set shared with the backend', () => {
  it('loads the whole labelled set', () => {
    expect(POSITIVES.length + NEGATIVES.length).toBeGreaterThanOrEqual(100);
  });
  it.each(POSITIVES)('notices: %s', (text) => {
    expect(detectCrisis(text)).not.toBe('none');
  });
  it.each(NEGATIVES)('stays calm: %s', (text) => {
    expect(detectCrisis(text)).toBe('none');
  });
});

describe('crisis extras from the coordinator brief', () => {
  it.each([
    "I've been thinking about ending things",
    'I keep hurting myself',
    "I've started cutting again",
    "I'm going to jump off the roof",
    "life isn't worth living",
    'kil myself',
    'kill myslef',
    "i'm suicidel",
    'feeling sucidal',
    'suicde is on my mind',
    "I'm just a burden",
    "I don't see the point in living",
    'no point in anything anymore',
    "I wish I'd never been born",
    'I just want everything to stop',
    'I want to sleep forever',
    'nobody would notice if I was gone',
    "I can't take this anymore",
    'mujhe jeena nahi hai',
    'main marna chahta hoon',
    'mar jana chahta hu',
    'khudkushi',
    'aatmahatya',
    'jeene ka mann nahi karta',
    'zindagi khatam',
    "I don't want to live",
  ])('notices: %s', (text) => expect(detectCrisis(text)).not.toBe('none'));

  it.each([
    'writing an essay on suicide prevention',
    'assignment about self-harm awareness',
    'Suicide Squad is on tonight',
    'I want to disappear into a book for a while',
    "I'm not suicidal",
    "I don't want to die",
  ])('stays calm: %s', (text) => expect(detectCrisis(text)).toBe('none'));
});
