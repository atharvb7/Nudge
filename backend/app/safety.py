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
    r"\bdisappear\s+into\s+(?:a|an|my|the|some)\s+\w+",
    # Academic topics ("essay on suicide prevention") are coursework, not a disclosure.
    r"\b(?:essay|paper|report|research|assignment|lecture|presentation|article|chapter|project|study|"
    r"campaign|module|thesis|seminar|course)s?\s+(?:on|about|regarding|into|covering)\s+(?:\w+\s+){0,2}"
    r"(?:suicide|self[\s-]?harm)(?:\s+(?:prevention|awareness|statistics|rates?|research|campaigns?))*\b",
]

# Tier 1: explicit self-harm or suicidal language (with common typos).
_EXPLICIT = [
    r"\bkill(?:ing)?\s+my\s*self\b",
    r"\bkil+(?:ing)?\s+my\s*s(?:el|le|ef)l?f?\b",
    r"\bsu[ie]?c[iu]?d(?:e|al|el|le)s?\b",
    r"\bend(?:ing)?\s+(?:things|everything)\b",
    r"\bplan(?:ning)?\s+to\s+end\s+it\b",
    r"\b(?:started|keep|been)\s+cutting(?:\s+again)?\b",
    r"\bcutting\s+(?:again|myself|my\s+(?:arms?|wrists?|legs?))\b",
    r"\bjump(?:ing)?\s+off\s+(?:the\s+|a\s+)?(?:roof|bridge|building|terrace|balcony|cliff|hostel)\b",
    r"\bsuicide\s+note\b",
    r"(?:\bnot|n't)\s+worth\s+living\b",
    # Hindi / Hinglish (romanised)
    r"\bjeena\s+nahi\b",
    r"\bmar(?:na|\s+ja(?:a)?na)\s+chaht[aie]\b",
    r"\bkhud\s*kushi\b",
    r"\baatm?a?hatya\b",
    r"\bjeene\s+ka\s+(?:mann|man|mun)\s+nahi\b",
    r"\bzindagi\s+(?:khatam|khtm)\b",
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
    r"\b(?:i'?m|i\s+am|im)\s+(?:so\s+|just\s+|really\s+|totally\s+|honestly\s+)?(?:done|finished|over)\s+with\s+(?:my\s+)?(?:life|living|being\s+alive|existing|this\s+life|this\s+world)\b",
    r"\bdone\s+with\s+(?:my\s+)?(?:life|living|being\s+alive|existing)\b",
    r"\b(?:tired|sick)\s+of\s+(?:living|being\s+alive|existing|life)\b",
    r"\b(?:my\s+)?life\s+is\s+(?:over|finished|done)\b",
    r"\bready\s+to\s+(?:die|end\s+it)\b",
    r"\bwant\s+(?:to\s+)?(?:end|stop)\s+(?:it\s+all|my\s+life|living|existing)\b",
    r"\bwon'?t\s+be\s+(?:around|here|alive)\s+(?:much\s+longer|tomorrow|any\s*more|for\s+long)\b",
    r"\bgoodbye\s+(?:forever|world|cruel\s+world)\b",
    r"\b(?:should|deserve\s+to)\s+(?:just\s+)?die\b",
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
    r"\bwant\s+(?:it\s+all|everything)\s+to\s+(?:stop|end)\b",
    r"\bsleep\s+forever\b",
    r"\b(?:nobody|no\s*-?\s*one)\s+would\s+(?:even\s+)?(?:notice|care|miss\s+me)\s+if\s+i\b",
    r"\beverything\s+(?:is|feels)\s+(?:so\s+)?hopeless\b",
    r"\b(?:what'?s|whats|what\s+is)\s+the\s+point\s+(?:of|in)\s+(?:living|life|being\s+alive|going\s+on)\b",
    r"\bsee\s+(?:the|any)\s+point\s+(?:in|of)\s+(?:living|life|going\s+on|being\s+alive)\b",
    r"\b(?:can'?t|cannot)\s+(?:take|do)\s+(?:this|it)\s+any\s*more\b",
    r"\bwish\s+i(?:'d|\s+had|\s+would\s+have)\s+never\s+been\s+born\b",
    r"\b(?:i'?m|i\s+am|im)\s+(?:so\s+|such\s+a\s+|just\s+a\s+|a\s+|just\s+|completely\s+|totally\s+|really\s+)?(?:worthless|useless|a\s+failure|a\s+waste(?:\s+of\s+space)?|a\s+disappointment|pathetic|a\s+mistake)\b",
    r"\b(?:i'?m|i\s+am|im)\s+so\s+(?:bad|stupid|dumb)\s*(?:[,.!]|$)",
    r"\b(?:i'?m|i\s+am|im)\s+(?:so\s+)?done\s+with\s+everything\b",
    r"\bcan'?t\s+live\s+like\s+this\b",
    r"\bi\s+(?:ruin|mess\s+up|destroy)\s+everything\b",
    r"\beveryone\s+hates\s+me\b",
    r"\bnothing\s+left\s+(?:for\s+me|to\s+live\s+for)\b",
    r"\b(?:what'?s|whats)\s+(?:even\s+)?the\s+point\s+of\s+me\b",
    r"\bcan'?t\s+do\s+life\s+any\s*more\b",
    r"\b(?:so\s+)?empty\s+inside\b",
    r"\bthink(?:ing)?\s+about\s+not\s+being\s+(?:here|alive|around)\b",
    r"\b(?:world|everyone|everybody)\s+(?:is|would\s+be|'d\s+be)\s+better\s+without\s+me\b",
]

# Positive-form phrases where a negation right before means the opposite
# ("I'm not suicidal", "I don't want to die"). Kill/hurt/harm phrases are
# deliberately not negatable: care comes first.
_NEGATABLE = re.compile(r"su[ie]?c[iu]?d|want|wanna", re.I)
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


# Semantic safety net: phrase lists always miss some new wording, so when the
# MiniLM model is loaded we also compare the message's *meaning* against
# crisis examples vs. ordinary study-stress examples. It can only escalate to
# the gentler "hopeless" level (which offers "I'm safe — just frustrated").
_CRISIS_EXAMPLES = [
    "I want to die", "I want to end my life", "I don't want to live anymore", "I'm done with my life",
    "I want to kill myself", "there is no point in living", "everyone would be better off without me",
    "I want to disappear forever", "I can't go on anymore", "I'm thinking about suicide", "I want to hurt myself",
    "life isn't worth it", "I feel hopeless and empty", "I'm worthless and nobody cares", "I wish I wasn't alive",
    "I'm tired of being alive", "I want it all to be over", "I can't take this pain anymore",
    "I don't see a future for myself", "nobody would miss me if I was gone",
]
_STRESS_EXAMPLES = [
    "I'm stuck on my assignment", "this homework is so boring", "I'm tired and want to sleep",
    "I'm stressed about my exam", "I can't focus on this essay", "I'm done with this assignment",
    "I hate this subject", "I'm so bad at maths", "this code is killing me", "I'm overwhelmed with work",
    "I want to quit this course", "I'm exhausted after the lecture", "I give up on this problem", "I need a break",
    "I don't want to do this task", "I'm procrastinating again", "ugh I can't start", "I feel lazy today",
    "my brain is fried", "I want to disappear into a book",
]
SEMANTIC_MIN = 0.55  # similarity to the closest crisis example
SEMANTIC_MARGIN = 0.15  # ...and this much closer than to any study-stress example
_NEGATED_CRISIS = re.compile(r"\b(?:not|never)\s+(?:suicidal|going\s+to\s+hurt\s+myself)\b|\bdon'?t\s+want\s+to\s+die\b", re.I)
_example_vectors = None


def _semantic_hit(text: str) -> bool:
    global _example_vectors
    from . import retrieval  # local import: retrieval imports nothing from here

    model = getattr(retrieval.semantic_model(), "encode", None)
    if model is None or len(text) < 8 or _NEGATED_CRISIS.search(text):
        return False
    try:
        if _example_vectors is None:
            _example_vectors = (
                model(_CRISIS_EXAMPLES, normalize_embeddings=True),
                model(_STRESS_EXAMPLES, normalize_embeddings=True),
            )
        crisis, stress = _example_vectors
        # long rambles: check each sentence so one worrying line isn't diluted
        parts = [p for p in re.split(r"(?<=[.!?])\s+|\n+", text[:4000]) if len(p.strip()) >= 8] or [text]
        vecs = model(parts[:40], normalize_embeddings=True)
        for v in vecs:
            c, s = float((crisis @ v).max()), float((stress @ v).max())
            if c >= SEMANTIC_MIN and c - s >= SEMANTIC_MARGIN:
                return True
    except Exception:  # never let the safety net break a request
        return False
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
    if _semantic_hit(t):
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
