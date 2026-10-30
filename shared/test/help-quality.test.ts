import { describe, expect, it } from 'vitest';
import {
  STRATEGIES,
  canAutoNudge,
  cardFitsKind,
  cleanTabTitle,
  defaultSettings,
  dumpItems,
  extractTask,
  fillTask,
  freshGuard,
  isSafeTaskLabel,
  localBrainDump,
  localSequence,
  markDayClosed,
  markDismissed,
  markSessionStarted,
  recordFeedback,
  rollover,
  seededRandom,
  splitDump,
  taskKind,
  thompsonScores,
  wakingDayKey,
  type SequenceRequest,
  type StrategyStats,
} from '../src';

const MIN = 60_000;
const HOUR = 60 * MIN;

function req(p: Partial<SequenceRequest> = {}): SequenceRequest {
  return {
    task: '',
    state: 'stuck',
    energy: 3,
    history: [],
    top_strategies: [],
    action: 'start',
    wording_style: 'warm',
    explain_why: false,
    ...p,
  };
}

describe('task names are safe', () => {
  it('worrying or feeling text never becomes a task', () => {
    for (const t of ['I want to end it', 'i took a lot of pills', "I'm such a burden", 'thinking about jumping', 'ugh I hate this', 'life isnt worth it'])
      expect(isSafeTaskLabel(t), t).toBe(false);
    for (const t of ['essay', 'DBMS assignment', 'call mom', 'laundry']) expect(isSafeTaskLabel(t), t).toBe(true);
  });
  it('localSequence never echoes a missed crisis phrase as {task}', () => {
    for (let i = 0; i < 40; i++) {
      const r = localSequence(req({ task: 'I want to end it', action: i % 2 ? 'next' : 'start' }), 'IN', seededRandom(i));
      expect(r.next_step + (r.lead ?? '')).not.toMatch(/end it/i);
    }
  });
  it('pulls the task out of a feeling sentence', () => {
    expect(extractTask("ugh I can't start my essay")).toBe('essay');
    expect(extractTask("i can't even begin the DBMS assignment lol")).toBe('DBMS assignment');
    expect(extractTask('stuck on my lab report because it is boring')).toBe('lab report');
    expect(extractTask('this essay is killing me')).toBe('essay');
    expect(extractTask("ugh I can't start")).toBe('');
    expect(extractTask('I want to end it')).toBe('');
  });
});

describe('task kinds and tab titles', () => {
  it('classifies per the shared rule', () => {
    expect(taskKind('call mom')).toBe('message');
    expect(taskKind('laundry')).toBe('chore');
    expect(taskKind('pay mess fees')).toBe('admin');
    expect(taskKind('debug my code')).toBe('code');
    expect(taskKind('read chapter 3')).toBe('reading');
    expect(taskKind('revise for ML quiz')).toBe('study');
    expect(taskKind('essay')).toBe('doc');
    expect(taskKind('DBMS_Assignment.pdf')).toBe('doc');
    expect(taskKind('lecture_notes.pdf')).toBe('study');
    expect(taskKind('something')).toBe('unknown');
  });
  it('cleans tab titles', () => {
    expect(cleanTabTitle('Google Docs - Untitled document')).toBe('');
    expect(cleanTabTitle('Untitled document - Google Docs')).toBe('');
    expect(cleanTabTitle('History essay - Google Docs')).toBe('History essay');
    expect(cleanTabTitle('(3) OS_Lab_Report.docx - Microsoft Word')).toBe('OS_Lab_Report.docx');
    expect(cleanTabTitle('main.tex - Overleaf, Online LaTeX Editor')).toBe('main.tex');
  });
  it('chores and calls never get document steps', () => {
    for (const task of ['laundry', 'call mom']) {
      for (let i = 0; i < 60; i++) {
        const r = localSequence(req({ task, action: (['start', 'different', 'smaller', 'too_big'] as const)[i % 4] }), 'IN', seededRandom(i));
        expect(r.next_step, `${task}: ${r.strategy_id}`).not.toMatch(/heading|rubric|paragraph|title of|first sentence|Intro, Middle|Just open the call|Open the call/i);
      }
    }
  });
});

describe('every card reads well for every kind of task', () => {
  const tasks = ['essay', 'laundry', 'call mom', 'email prof', 'DBMS assignment', ''];
  const tabs = [undefined, 'DBMS_Assignment.pdf', 'Google Docs - Untitled document', 'Untitled document - Google Docs'];
  const BAD = [/your your/i, /finished your/i, /\byour (Call|Email|Text|Laundry)\b/, /\{task\}/, /\s{2,}/, /[.!?]\s+[a-z]/, /^[a-z]/, /the the\b/i, /Google Docs/];
  it('no broken grammar or leftovers', () => {
    for (const style of ['warm', 'literal'] as const)
      for (const task of tasks)
        for (const tab of tabs) {
          const kind = taskKind(task || tab || '');
          for (const c of STRATEGIES) {
            if (!cardFitsKind(c, kind, task)) continue;
            for (const step of style === 'literal' ? c.literal_version : c.steps) {
              const out = fillTask(step, task, tab, style);
              for (const re of BAD) expect(out, `${c.id} | ${task} | ${tab} → ${out}`).not.toMatch(re);
            }
          }
        }
  });
  it('"Make it smaller" never glues a prefix onto a question', () => {
    for (const task of ['essay', 'laundry', 'call mom', '']) {
      const r = localSequence(req({ task, action: 'smaller' }), 'IN', seededRandom(2));
      expect(r.next_step).not.toMatch(/^Even smaller/);
      expect(r.next_step).toMatch(/^[A-Z"“]/);
    }
  });
});

describe('kindness signals', () => {
  it('"ugh / can\'t start / so hard" gets a validation line', () => {
    for (const t of ["ugh I can't start my essay", 'this is so hard', "I can't start"])
      expect(localSequence(req({ task: 'essay', transcript: t }), 'IN', seededRandom(1)).validation, t).toBeTruthy();
  });
  it('depleted is rest-first', () => {
    const r = localSequence(req({ task: 'essay', state: 'depleted', energy: 3 }), 'IN', seededRandom(3));
    expect(r.suggest_rest).toBe(true);
    expect(r.lead).toMatch(/rest/i);
  });
});

describe('brain dump', () => {
  it('splits numbered and bulleted lists, drops filler', () => {
    expect(splitDump('1. ML quiz 2. resume 3. idk')).toEqual(['ML quiz', 'resume']);
    expect(splitDump('- laundry\n- email prof\n* lol')).toEqual(['laundry', 'email prof']);
    expect(dumpItems('idk, stuff, finish essay').items).toEqual(['Finish essay']);
  });
  it('does not pick a chore over uni work unless energy is low', () => {
    const t = 'laundry, finish the DBMS assignment, clean room';
    expect(localBrainDump(t, 'warm', 'IN', 3).pick?.item).toMatch(/DBMS/);
    const low = localBrainDump(t, 'warm', 'IN', 1).pick!;
    expect(low.item).toMatch(/laundry|room/i);
    expect(low.first_step).not.toMatch(/open whatever/i);
  });
  it('first steps fit the item', () => {
    expect(localBrainDump('call mom', 'warm').pick?.first_step).toMatch(/three words/);
    expect(localBrainDump('email prof', 'warm').pick?.first_step).toMatch(/first line/);
  });
});

describe('👎 matters', () => {
  it("a disliked card's chance of being shown drops substantially", () => {
    const count = (stats: StrategyStats) => {
      let n = 0;
      const rand = seededRandom(9);
      for (let i = 0; i < 400; i++) {
        const top = thompsonScores(STRATEGIES, stats, rand); // ALL scores, as the panel now sends
        const r = localSequence(req({ task: 'essay', top_strategies: top }), 'IN', rand);
        if (r.strategy_id === 'ugly_first_draft') n++;
      }
      return n;
    };
    const before = count({});
    let disliked: StrategyStats = {};
    for (let i = 0; i < 3; i++) disliked = recordFeedback(disliked, 'ugly_first_draft', 'down');
    const after = count(disliked);
    expect(before).toBeGreaterThan(10);
    expect(after).toBeLessThan(before * 0.5);
  });
});

describe('waking day (05:00 rollover)', () => {
  const at = (h: number, m = 0, d = 29) => new Date(2026, 9, d, h, m).getTime();
  const settings = { ...defaultSettings(at(9, 0, 1)), onboarded: true };
  const ctx = (now: number) => ({ now, state: 'stuck' as const, fullscreen: false, onCall: false, onBreak: false });

  it('1 am still belongs to yesterday', () => {
    expect(wakingDayKey(at(1, 0, 30))).toBe(wakingDayKey(at(23, 0, 29)));
    expect(wakingDayKey(at(6, 0, 30))).not.toBe(wakingDayKey(at(23, 0, 29)));
  });
  it('a third dismissal at 23:50 is not undone at midnight', () => {
    let g = freshGuard(at(23, 0));
    for (let i = 0; i < 3; i++) g = markDismissed(g, at(23, 50)).guard;
    expect(canAutoNudge({ ...g, lastAutoNudgeAt: 0 }, settings, ctx(at(0, 10, 30))).ok).toBe(false);
    expect(canAutoNudge({ ...g, lastAutoNudgeAt: 0 }, settings, ctx(at(9, 0, 30))).ok).toBe(true);
  });
  it('"Done for today" lasts past midnight and past 05:00 if it was recent', () => {
    const g = markDayClosed(freshGuard(at(23, 0)), at(23, 40));
    expect(canAutoNudge(g, settings, ctx(at(0, 30, 30))).ok).toBe(false);
    const late = markDayClosed(freshGuard(at(4, 0, 30)), at(4, 30, 30));
    expect(rollover(late, at(5, 30, 30)).dayClosed).toBe(true); // only 1 h ago
    expect(rollover(late, at(9, 0, 30)).dayClosed).toBe(false); // ≥ 4 h and past 05:00
    expect(markSessionStarted(g, at(0, 45, 30)).dayClosed).toBe(false); // user chose to come back
  });
});
