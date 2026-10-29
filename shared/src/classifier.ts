import type { SiteCategory } from './types';

// Domain-only context classifier. We never look at page content.
// Switching between work sites is NOT stuck — research often means many tabs.

export const WORK_DOMAINS = [
  // docs & writing
  'docs.google.com', 'drive.google.com', 'sheets.google.com', 'slides.google.com', 'notion.so', 'notion.site',
  'onedrive.live.com', 'office.com', 'sharepoint.com', 'overleaf.com', 'dropbox.com', 'evernote.com', 'obsidian.md',
  'quip.com', 'coda.io', 'canva.com', 'figma.com', 'miro.com', 'docs.microsoft.com', 'learn.microsoft.com',
  // LMS & uni
  'moodle', 'canvas', 'instructure.com', 'blackboard.com', 'classroom.google.com', 'brightspace', 'd2l',
  'schoology.com', 'edmodo.com', 'piazza.com', 'gradescope.com', 'turnitin.com',
  // code
  'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'stackexchange.com', 'superuser.com',
  'serverfault.com', 'developer.mozilla.org', 'w3schools.com', 'geeksforgeeks.org', 'leetcode.com',
  'hackerrank.com', 'codechef.com', 'replit.com', 'colab.research.google.com', 'kaggle.com', 'python.org',
  'docs.python.org', 'readthedocs.io', 'npmjs.com', 'pypi.org', 'localhost', '127.0.0.1',
  // lecture video & courses
  'nptel.ac.in', 'swayam.gov.in', 'coursera.org', 'edx.org', 'khanacademy.org', 'udemy.com', 'mit.edu',
  'ocw.mit.edu', 'brilliant.org', 'panopto.com', 'echo360',
  // research & reference
  'scholar.google.com', 'arxiv.org', 'jstor.org', 'researchgate.net', 'sciencedirect.com', 'springer.com',
  'ieee.org', 'acm.org', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'wikipedia.org', 'britannica.com',
  'wolframalpha.com', 'desmos.com', 'symbolab.com', 'grammarly.com', 'quillbot.com', 'zotero.org',
  'mendeley.com', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai',
  'translate.google.com', 'dictionary.com', 'merriam-webster.com', 'thesaurus.com', 'local-file',
];

export const ESCAPE_DOMAINS = [
  // social
  'instagram.com', 'facebook.com', 'twitter.com', 'x.com', 'reddit.com', 'tiktok.com', 'snapchat.com',
  'threads.net', 'tumblr.com', 'pinterest.com', 'linkedin.com', 'discord.com', 'bsky.app', 'mastodon.social',
  'web.whatsapp.com', 'web.telegram.org', 'quora.com', '9gag.com',
  // entertainment
  'netflix.com', 'primevideo.com', 'hotstar.com', 'jiocinema.com', 'disneyplus.com', 'twitch.tv',
  'crunchyroll.com', 'spotify.com', 'music.youtube.com', 'soundcloud.com', 'imdb.com', 'buzzfeed.com',
  'store.steampowered.com', 'steamcommunity.com', 'epicgames.com', 'roblox.com', 'chess.com', 'lichess.org',
  'amazon.in', 'amazon.com', 'flipkart.com', 'myntra.com', 'meesho.com', 'ajio.com', 'swiggy.com', 'zomato.com',
  'news.ycombinator.com', 'cricbuzz.com', 'espncricinfo.com',
];

/**
 * Deliberately ambiguous: YouTube hosts both lectures and rabbit holes. We stay
 * neutral (never counted as escape) unless the user tags it as research.
 */
export const AMBIGUOUS_DOMAINS = ['youtube.com', 'youtu.be', 'medium.com', 'substack.com', 'mail.google.com', 'outlook.live.com', 'outlook.office.com'];

/** Video-call sites: auto-silence nudges. */
export const CALL_DOMAINS = ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'teams.live.com', 'whereby.com', 'webex.com', 'meet.jit.si'];

function matches(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((d) => {
    const dom = d.split('/')[0].toLowerCase();
    if (!dom.includes('.')) return h.includes(dom); // keyword like "moodle"
    return h === dom || h.endsWith('.' + dom);
  });
}

export interface ClassifierLists {
  researchSites?: string[]; // user-tagged as work
  escapeSites?: string[]; // user-tagged as escape
}

export function classifyHost(host: string, lists: ClassifierLists = {}): SiteCategory {
  if (!host) return 'neutral';
  if (lists.researchSites && matches(host, lists.researchSites)) return 'work';
  if (lists.escapeSites && matches(host, lists.escapeSites)) return 'escape';
  if (matches(host, AMBIGUOUS_DOMAINS)) return 'neutral';
  if (matches(host, WORK_DOMAINS)) return 'work';
  if (matches(host, ESCAPE_DOMAINS)) return 'escape';
  return 'neutral';
}

export function isCallHost(host: string): boolean {
  return matches(host, CALL_DOMAINS);
}

export function isExcluded(host: string, excluded: string[]): boolean {
  return !!host && matches(host, excluded);
}
