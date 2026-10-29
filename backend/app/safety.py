"""Crisis-language classifier.

Runs on every free-text input before anything else. If it fires, coaching
stops and the user gets warmth + resources. Matched text is never logged
or stored.

Design choices:
* Err on the side of care: explicit self-harm language always triggers, even
  when it might be hyperbole ("this essay makes me want to kill myself").
* Common study idioms ("this is killing me", "dead tired", "kill this bug")
  are removed before matching so they don't trigger.
* A small negation guard handles "I'm not suicidal" / "I don't want to die",
  but never for phrases that are themselves negative ("don't want to live").
"""

from __future__ import annotations

import re

from .models import Resource, SafetyPayload

# Idioms that look alarming but are everyday student talk. Removed before matching.
_IDIOMS = [
    r"\b(?:is|are|was|it'?s|its|this|that|these|you'?re)\s+(?:\w+\s+){0,3}killing me\b",
    r"\bkilling me softly\b",
    r"\bkill(?:ing|ed)?\s+(?:this|the|that|a|my|these|those)\s+(?:bug|bugs|process|processes|task|tab|tabs|"
    r"essay|exam|test|quiz|presentation|interview|assignment|game|level|boss|lights?|music|vibe|time|server|job)\b",
    r"\bkill(?:ing)? time\b",
    r"\bkill(?:ed|ing)? it\b",
    r"\b(?:i'?m|i am|feel|feeling)\s+(?:so\s+|totally\s+|literally\s+)?dead\s+(?:tired|bored|serious|inside lol)\b",
    r"\bdead tired\b",
    r"\bdying\s+(?:of|from)\s+(?:boredom|laughter|embarrassment|cringe|heat|hunger|thirst)\b",
    r"\bdying\s+to\s+(?:know|see|try|go|eat|sleep|watch|hear|meet)\b",
    r"\b(?:i'?m|i am)\s+dead\s*(?:lol|lmao|haha|😂|💀)",
    r"\bdie\s+of\s+(?:embarrassment|boredom|cringe|laughter)\b",
    r"\bsuicide\s+squad\b",
    r"\bdeadline\w*\b",
]

# Tier 1: explicit self-harm or suicidal language.
_EXPLICIT = [
    r"\bkill(?:ing)?\s+my\s*self\b",
    r"\bkms\b",
    r"\bend(?:ing)?\s+(?:my|it)\s+(?:life|all)\b",
    r"\bend\s+it\s+all\b",
    r"\btak(?:e|ing)\s+my\s+(?:own\s+)?life\b",
    r"\bsuicid(?:e|al)\b",
    r"\b(?:want|wanna|plan(?:ning)?)\s+(?:to\s+)?die\b",
    r"\bwish\s+i\s+(?:was|were|could\s+be)\s+dead\b",
    r"\bbetter\s+off\s+dead\b",
    r"\b(?:hurt|harm|cut|cutting|hurting|harming)\s+my\s*self\b",
    r"\bself[\s-]?harm(?:ing)?\b",
    r"\boverdos(?:e|ing)\b",
    r"\bdon'?t\s+want\s+to\s+(?:be\s+alive|live|exist|be\s+here)\s*(?:anymore|any\s+more)?\b",
    r"\bdo\s+not\s+want\s+to\s+(?:be\s+alive|live|exist)\b",
    r"\bno\s+reason\s+to\s+(?:live|be\s+alive|go\s+on|keep\s+going)\b",
    r"\bnot\s+worth\s+living\b",
]

# Tier 2: hopelessness / disappearance / burden language.
_HOPELESS = [
    r"\bno\s+point\s+(?:in\s+)?(?:living|life|being\s+alive|going\s+on|existing|in\s+anything)\b",
    r"\bno\s+point\s+to\s+(?:my\s+)?life\b",
    r"\b(?:every(?:one|body)|they|the\s+world|my\s+family)\s+(?:would\s+be|is|are|'d\s+be)\s+better\s+off\s+without\s+me\b",
    r"\bbetter\s+off\s+without\s+me\b",
    r"\b(?:want|wanna|wish\s+i\s+could)\s+(?:to\s+)?(?:just\s+)?disappear\b",
    r"\bwish\s+i\s+(?:didn'?t|did\s+not)\s+exist\b",
    r"\bwish\s+i\s+(?:had|'?d)\s+never\s+been\s+born\b",
    r"\b(?:never|not)\s+wake\s+up\b",
    r"\bcan'?t\s+go\s+on\b",
    r"\bcan'?t\s+keep\s+living\b",
    r"\bhate\s+being\s+alive\b",
    r"\b(?:i'?m|i\s+am)\s+(?:just\s+)?a\s+burden\b",
    r"\bfeel(?:ing)?\s+(?:so\s+|completely\s+|totally\s+)?hopeless\b",
    r"\blife\s+is\s+(?:so\s+)?(?:pointless|meaningless|hopeless|not\s+worth\s+it)\b",
    r"\bno\s+way\s+out\b",
]

# Positive-form phrases where a negation right before means the opposite
# ("I'm not suicidal", "I don't want to die"). Kill/hurt/harm phrases are
# deliberately not negatable: care comes first.
_NEGATABLE = re.compile(r"suicid|want|wanna", re.I)
_NEGATION_BEFORE = re.compile(r"(?:\bnot|n't|\bnever|\bno longer)\s+(?:\w+\s+){0,2}$", re.I)

_IDIOM_RE = [re.compile(p, re.I) for p in _IDIOMS]
_EXPLICIT_RE = [re.compile(p, re.I) for p in _EXPLICIT]
_HOPELESS_RE = [re.compile(p, re.I) for p in _HOPELESS]


def _normalise(text: str) -> str:
    t = (text or "").replace("’", "'").replace("‘", "'")
    t = re.sub(r"\s+", " ", t).strip()
    for rx in _IDIOM_RE:
        t = rx.sub(" ", t)
    return t


def _hit(patterns: list[re.Pattern[str]], text: str, allow_negation: bool) -> bool:
    for rx in patterns:
        for m in rx.finditer(text):
            if allow_negation and _NEGATABLE.match(m.group(0)):
                before = text[max(0, m.start() - 24) : m.start()]
                if _NEGATION_BEFORE.search(before):
                    continue
            return True
    return False


def classify(text: str) -> str | None:
    """Return "explicit", "hopeless" or None. Never logs the text."""
    t = _normalise(text)
    if not t:
        return None
    if _hit(_EXPLICIT_RE, t, allow_negation=True):
        return "explicit"
    if _hit(_HOPELESS_RE, t, allow_negation=False):
        return "hopeless"
    return None


RESOURCES: dict[str, list[Resource]] = {
    "IN": [
        Resource(name="Tele-MANAS", phone="14416", alt="1-800-891-4416",
                 note="Free, 24x7, government mental health helpline. Many Indian languages."),
        Resource(name="Emergency", phone="112", note="If you're in immediate danger."),
    ],
    "US": [
        Resource(name="988 Suicide & Crisis Lifeline", phone="988", note="Call or text, 24/7, free."),
        Resource(name="Emergency", phone="911", note="If you're in immediate danger."),
    ],
    "CA": [
        Resource(name="9-8-8 Suicide Crisis Helpline", phone="988", note="Call or text, 24/7, free."),
        Resource(name="Emergency", phone="911", note="If you're in immediate danger."),
    ],
    "UK": [
        Resource(name="Samaritans", phone="116 123", note="Free, 24/7, any time of day or night."),
        Resource(name="Emergency", phone="999", note="If you're in immediate danger."),
    ],
    "AU": [
        Resource(name="Lifeline", phone="13 11 14", note="24/7 crisis support."),
        Resource(name="Emergency", phone="000", note="If you're in immediate danger."),
    ],
    "OTHER": [
        Resource(name="Find A Helpline", url="https://findahelpline.com",
                 note="Free, confidential helplines in your country."),
        Resource(name="Emergency", note="Your local emergency number, if you're in immediate danger."),
    ],
}
RESOURCES["GB"] = RESOURCES["UK"]


def resources_for(region: str | None, default: str = "IN") -> list[Resource]:
    key = (region or default or "OTHER").upper()
    return RESOURCES.get(key, RESOURCES["OTHER"])


def safety_payload(region: str | None, default: str = "IN") -> SafetyPayload:
    return SafetyPayload(
        crisis=True,
        message=(
            "I'm really glad you told me. It sounds like you're carrying something very heavy right now, "
            "and you deserve real support with it. Let's put the task aside completely — it can wait. "
            "You don't have to go through this alone."
        ),
        resources=resources_for(region, default),
        reach_out=(
            "If you can, reach out to someone you trust — a friend, family member, or someone on campus — "
            "and tell them how you're feeling. Talking to one of the people above is also okay, any time."
        ),
    )


def check(*texts: str | None) -> bool:
    return any(classify(t or "") for t in texts)
