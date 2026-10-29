import type { CrisisResource, Region, SafetyPayload } from './types';

// On-device crisis-language check. Runs before any coaching, works offline.
// Matching text is NEVER stored — callers must not persist the message.
// It deliberately errs toward care: a false positive shows a kind message and
// resources; a false negative is the outcome we most want to avoid.

// Patterns mirror backend/app/safety.py (kept in parity by test/crisis-set.test.ts,
// which uses the same labelled phrase set as backend/tests/test_safety_set.py).
// Text is normalised first: curly quotes → ', whitespace collapsed, idioms removed.

/** Everyday student talk that only *looks* alarming. Removed before matching. */
const IDIOMS: RegExp[] = [
  /\b(?:is|are|was|it'?s|its|this|that|these|you'?re)\s+(?:\w+\s+){0,3}killing me\b/gi,
  /\bkilling me softly\b/gi,
  /\bkill(?:ing|ed)?\s+(?:this|the|that|a|my|these|those)\s+(?:bug|bugs|process|processes|task|tab|tabs|essay|exam|test|quiz|presentation|interview|assignment|game|level|boss|lights?|music|vibe|time|server|job)\b/gi,
  /\bkill(?:ing)? time\b/gi,
  /\bkill(?:ed|ing)? it\b/gi,
  /\b(?:i'?m|i am|feel|feeling)\s+(?:so\s+|totally\s+|literally\s+)?dead\s+(?:tired|bored|serious|inside lol)\b/gi,
  /\bdead tired\b/gi,
  /\bdying\s+(?:of|from)\s+(?:boredom|laughter|embarrassment|cringe|heat|hunger|thirst)\b/gi,
  /\bdying\s+to\s+(?:know|see|try|go|eat|sleep|watch|hear|meet)\b/gi,
  /\b(?:i'?m|i am)\s+dead\s*(?:lol|lmao|haha|😂|💀)/gi,
  /\bdie\s+of\s+(?:embarrassment|boredom|cringe|laughter)\b/gi,
  /\bsuicide\s+squad\b/gi,
  /\bdeadline\w*\b/gi,
  /\bdeadly\s+boring\b/gi,
  /\bdisappear\s+into\s+(?:a|an|my|the|some)\s+\w+/gi,
  // Academic topics ("essay on suicide prevention") are coursework, not a disclosure.
  /\b(?:essay|paper|report|research|assignment|lecture|presentation|article|chapter|project|study|campaign|module|thesis|seminar|course)s?\s+(?:on|about|regarding|into|covering)\s+(?:\w+\s+){0,2}(?:suicide|self[\s-]?harm)(?:\s+(?:prevention|awareness|statistics|rates?|research|campaigns?))*\b/gi,
];

/** Tier 1 — explicit self-harm or suicidal language (with common typos and romanised Hindi). */
const HIGH_RISK: RegExp[] = [
  /\bkill(?:ing)?\s+my\s*self\b/i,
  /\bkil+(?:ing)?\s+my\s*s(?:el|le|ef)l?f?\b/i,
  /\bsu[ie]?c[iu]?d(?:e|al|el|le)s?\b/i,
  /\bend(?:ing)?\s+(?:things|everything)\b/i,
  /\bplan(?:ning)?\s+to\s+(?:end\s+it|die|kill\s+myself)\b/i,
  /\b(?:started|keep|been)\s+cutting(?:\s+again)?\b/i,
  /\bcutting\s+(?:again|myself|my\s+(?:arms?|wrists?|legs?))\b/i,
  /\bjump(?:ing)?\s+off\s+(?:the\s+|a\s+)?(?:roof|bridge|building|terrace|balcony|cliff|hostel)\b/i,
  /\bsuicide\s+note\b/i,
  /(?:\bnot|n't)\s+worth\s+living\b/i,
  // Hindi / Hinglish (romanised)
  /\bjeena\s+nahi\b/i,
  /\bmar(?:na|\s+ja(?:a)?na)\s+chaht[aie]\b/i,
  /\bkhud\s*kushi\b/i,
  /\baatm?a?hatya\b/i,
  /\bjeene\s+ka\s+(?:mann|man|mun)\s+nahi\b/i,
  /\bzindagi\s+(?:khatam|khtm)\b/i,
  /\bkms\b/i,
  /\bend(?:ing)?\s+(?:my|it)\s+(?:life|all)\b/i,
  /\bend\s+it\s+all\b/i,
  /\b(?:take|taking|end|ending)\s+my\s+(?:own\s+)?life\b/i,
  /\b(?:kill|hurt|harm|cut|end)\s+my\s+life\b/i,
  /\b(?:want|wanna|wanting|plan(?:ning)?)\s+(?:to\s+)?die\b/i,
  /\bwish\s+i\s+(?:was|were|could\s+be)\s+dead\b/i,
  /\bwish\s+i\s+could\s+die\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\b(?:hurt|harm|cut|cutting|hurting|harming)\s+my\s*self\b/i,
  /\bself[\s-]?harm(?:ing)?\b/i,
  /\boverdos(?:e|ing)\b/i,
  /\b(?:don'?t|do\s+not)\s+want\s+to\s+(?:be\s+alive|live|exist|wake\s+up|be\s+here)\s*(?:any\s*more)?\b/i,
  /\bno\s+reason\s+to\s+(?:live|be\s+alive|go\s+on|keep\s+going)\b/i,
  /\bno\s+(?:reason|point)\s+(?:in\s+|to\s+)?(?:living|being\s+alive)\b/i,
  /\bnot\s+be\s+here\s+any\s*more\b/i,
];

/** Tier 2 — hopelessness, disappearance and burden language. */
const HOPELESSNESS: RegExp[] = [
  /\bno\s+point\s+(?:in\s+)?(?:living|life|being\s+alive|going\s+on|existing|in\s+anything|anything)\b/i,
  /\bno\s+point\s+to\s+(?:my\s+)?life\b/i,
  /\b(?:every(?:one|body)|they|the\s+world|my\s+family)\s+(?:would\s+be|is|are|'d\s+be)\s+better\s+off\s+without\s+me\b/i,
  /\bbetter\s+off\s+without\s+me\b/i,
  /\b(?:want|wanna|wish\s+i\s+could)\s+(?:to\s+)?(?:just\s+)?disappear\b/i,
  /\bwish\s+i\s+(?:didn'?t|did\s+not)\s+exist\b/i,
  /\bwish\s+i\s+(?:was|were)n'?t\s+(?:alive|here|born)\b/i,
  /\bwish\s+i(?:'d|\s+had|\s+would\s+have)\s+never\s+been\s+born\b/i,
  /\b(?:never|not)\s+wake\s+up\b/i,
  /\bcan'?t\s+go\s+on\b/i,
  /\bcan'?t\s+keep\s+living\b/i,
  /\bhate\s+being\s+alive\b/i,
  /\bhate\s+(?:myself|my\s+life)\b/i,
  /\b(?:i'?m|i\s+am)\s+(?:just\s+)?a\s+burden\b/i,
  /\bfeel(?:s|ing)?\s+(?:so\s+|completely\s+|totally\s+|really\s+)?hopeless\b/i,
  /\b(?:everything|it\s+all|life)\s+(?:is|feels|'s)\s+(?:so\s+)?hopeless\b/i,
  /\blife\s+is\s+(?:so\s+)?(?:pointless|meaningless|hopeless|not\s+worth\s+it)\b/i,
  /\bno\s+way\s+out\b/i,
  /\bwant\s+(?:it\s+all|everything)\s+to\s+(?:stop|end)\b/i,
  /\bsleep\s+forever\b/i,
  /\b(?:nobody|no\s*-?\s*one)\s+would\s+(?:even\s+)?(?:notice|care|miss\s+me)\s+if\s+i\b/i,
  /\b(?:what'?s|whats|what\s+is)\s+the\s+point\s+(?:of|in)\s+(?:living|life|being\s+alive|going\s+on)\b/i,
  /\bsee\s+(?:the|any)\s+point\s+(?:in|of)\s+(?:living|life|going\s+on|being\s+alive)\b/i,
  /\b(?:can'?t|cannot)\s+(?:take|do)\s+(?:this|it)\s+any\s*more\b/i,
  /\bnothing\s+(?:matters|will\s+ever\s+get\s+better)\b/i,
  /\bgive\s+up\s+on\s+(?:life|everything|myself)\b/i,
];

export type CrisisLevel = 'none' | 'concern' | 'high';

// "I'm not suicidal" / "I don't want to die" mean the opposite. Only these
// positive-form phrases can be negated — never "don't want to live", and never
// kill/hurt/harm phrases: care comes first.
const NEGATABLE = /^(?:su[ie]?c[iu]?d|want|wanna)/i;
const NEGATION_BEFORE = /(?:\bnot|n't|\bnever|\bno longer)\s+(?:\w+\s+){0,2}$/i;

function hit(patterns: RegExp[], t: string, allowNegation: boolean): boolean {
  return patterns.some((r) => {
    const g = new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g');
    for (const m of t.matchAll(g)) {
      const at = m.index ?? 0;
      if (allowNegation && NEGATABLE.test(m[0]) && NEGATION_BEFORE.test(t.slice(Math.max(0, at - 24), at))) continue;
      return true;
    }
    return false;
  });
}

function normalise(text: string): string {
  let t = text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  for (const r of IDIOMS) t = t.replace(r, ' ');
  return t;
}

export function detectCrisis(text: string | null | undefined): CrisisLevel {
  if (!text) return 'none';
  const t = normalise(text);
  if (!t.trim()) return 'none';
  if (hit(HIGH_RISK, t, true)) return 'high';
  if (hit(HOPELESSNESS, t, false)) return 'concern';
  return 'none';
}

export const CRISIS_RESOURCES: Record<Region, CrisisResource[]> = {
  IN: [
    { name: 'Tele-MANAS', phone: '14416', alt: '1-800-891-4416', note: 'Free, 24×7, in many Indian languages' },
    { name: 'Emergency', phone: '112', note: 'If you are in immediate danger' },
  ],
  US: [
    { name: '988 Suicide & Crisis Lifeline', phone: '988', note: 'Call or text, 24/7' },
    { name: 'Emergency', phone: '911' },
  ],
  UK: [
    { name: 'Samaritans', phone: '116 123', note: 'Free, 24/7' },
    { name: 'Emergency', phone: '999' },
  ],
  OTHER: [{ name: 'Find a Helpline', url: 'https://findahelpline.com', note: 'Free, confidential support in your country' }],
};

export function safetyPayload(region: Region, level: CrisisLevel = 'high'): SafetyPayload {
  const message =
    level === 'high'
      ? "I'm really glad you told me. You matter, and you don't have to carry this alone. Let's put the task aside — talking to someone right now could really help."
      : "That sounds really heavy, and I'm glad you said it out loud. The task can wait. Would talking to someone help right now?";
  return { crisis: true, message, resources: CRISIS_RESOURCES[region] ?? CRISIS_RESOURCES.OTHER, level: level === 'concern' ? 'concern' : 'high' };
}

export const TRUSTED_PERSON_LINE =
  'You could also reach out to someone you trust — a friend, family member, or your campus counsellor.';
