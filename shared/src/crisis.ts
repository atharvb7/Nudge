import type { CrisisResource, Region, SafetyPayload } from './types';

// On-device crisis-language check. Runs before any coaching, works offline.
// Matching text is NEVER stored — callers must not persist the message.
// It deliberately errs toward care: a false positive shows a kind message and
// resources; a false negative is the outcome we most want to avoid.

const HIGH_RISK: RegExp[] = [
  /\b(kill|hurt|harm|cut|end)\s+(myself|my\s*self|my\s+life)\b/i,
  /\bsuicid(e|al)\b/i,
  /\b(take|taking|end|ending)\s+my\s+(own\s+)?life\b/i,
  /\bwant(ing)?\s+to\s+die\b/i,
  /\bwish\s+(i\s+(was|were)\s+dead|i\s+could\s+die|i\s+(was|were)n['’]?t\s+(alive|here|born))\b/i,
  /\b(don['’]?t|do\s+not)\s+want\s+to\s+(be\s+alive|live|exist|wake\s+up)\b/i,
  /\bself[\s-]?harm(ing)?\b/i,
  /\boverdos(e|ing)\b/i,
  /\bno\s+(reason|point)\s+(in\s+|to\s+)?(living|being\s+alive|going\s+on|live)\b/i,
  /\b(better\s+off|be\s+better)\s+without\s+me\b/i,
  /\b(can['’]?t|cannot)\s+go\s+on\s+(any\s*more|living|like\s+this)\b/i,
  /\bend\s+it\s+all\b/i,
  /\bnot\s+be\s+here\s+any\s*more\b/i,
  /\bplan(ning)?\s+to\s+(die|kill\s+myself|end\s+it)\b/i,
  /\bkms\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\bnot\s+worth\s+living\b/i,
];

const HOPELESSNESS: RegExp[] = [
  /\b(feel(s|ing)?|everything(['’]s|\s+is|\s+feels)|it\s+all\s+feels|life\s+(is|feels))\s+(so\s+|completely\s+|totally\s+|really\s+)?hopeless\b/i,
  /\bwant\s+to\s+disappear\b/i,
  /\bnothing\s+(matters|will\s+ever\s+get\s+better)\b/i,
  /\b(i['’]?m|i\s+am)\s+a\s+burden\b/i,
  /\bhate\s+(myself|my\s+life)\b/i,
  /\bno\s+way\s+out\b/i,
  /\b(never|not)\s+wake\s+up\b/i,
  /\bwish\s+i\s+(didn['’]?t|did\s+not)\s+exist\b/i,
  /\bwish\s+i\s+(had|['’]d)\s+never\s+been\s+born\b/i,
  /\blife\s+is\s+(so\s+)?(pointless|meaningless|not\s+worth\s+it)\b/i,
  /\bgive\s+up\s+on\s+(life|everything|myself)\b/i,
  /\b(can['’]?t|cannot)\s+(take|do)\s+(this|it)\s+any\s*more\b/i,
];

// Common hyperbole that should NOT trigger on its own.
const IDIOMS: RegExp[] = [
  /\b(this|it|that|the\s+\w+|assignment|exam|homework|essay|class|code|bug)\s+(is|was|'s)\s+killing\s+me\b/i,
  /\bkilling\s+me\b/i,
  /\bdead\s+tired\b/i,
  /\bdying\s+(of|from)\s+(boredom|laughter|embarrassment)\b/i,
  /\bkill\s+(this|the|that|a)\s+(bug|process|task|tab|server|job|time)\b/i,
  /\b(i['’]?m|i\s+am)\s+so\s+dead\b/i,
  /\bdie\s+of\s+(boredom|embarrassment)\b/i,
  /\bdeadly\s+boring\b/i,
];

export type CrisisLevel = 'none' | 'concern' | 'high';

export function detectCrisis(text: string | null | undefined): CrisisLevel {
  if (!text) return 'none';
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return 'none';
  if (HIGH_RISK.some((r) => r.test(t))) return 'high';
  const stripped = IDIOMS.reduce((acc, r) => acc.replace(r, ' '), t);
  if (HOPELESSNESS.some((r) => r.test(stripped))) return 'concern';
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
  return { crisis: true, message, resources: CRISIS_RESOURCES[region] ?? CRISIS_RESOURCES.OTHER };
}

export const TRUSTED_PERSON_LINE =
  'You could also reach out to someone you trust — a friend, family member, or your campus counsellor.';
