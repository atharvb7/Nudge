"""A larger labelled set for the crisis classifier.

Positives err toward care: ambiguous-but-worrying phrases count as positive.
Negatives are everyday student talk that only *looks* alarming.
"""

import pytest

from app.safety import classify

POSITIVES = [
    # explicit
    "I want to kill myself",
    "i want to kill my self",
    "honestly kms",
    "this essay makes me want to kill myself",
    "I've been thinking about suicide",
    "I feel suicidal tonight",
    "I want to die",
    "i just wanna die",
    "I wish I was dead",
    "I'm thinking about ending my life",
    "I want to take my own life",
    "I've been thinking about ending things",
    "I'm planning to end it",
    "I keep hurting myself",
    "I've started cutting again",
    "I want to self harm",
    "I have pills saved up to overdose",
    "I don't want to be alive anymore",
    "i dont want to live anymore",
    "I don't want to be here anymore",
    "I don't want to exist",
    "there's no reason to live",
    "life isn't worth living",
    "life is not worth living anymore",
    "I'm going to jump off the roof",
    "I wrote a suicide note",
    "better off dead",
    # typos
    "kil myself",
    "kill myslef",
    "i'm suicidel",
    "feeling sucidal",
    "suicde is on my mind",
    # hopeless / indirect
    "I just want everything to stop",
    "I want it all to end",
    "I can't do this anymore, I want to sleep forever",
    "I wish I could fall asleep and never wake up",
    "nobody would notice if I was gone",
    "no one would care if I disappeared",
    "everyone would be better off without me",
    "I'm a burden to everyone",
    "I'm just a burden",
    "I feel so hopeless",
    "everything is hopeless",
    "what's the point of living",
    "I don't see the point in living anymore",
    "there's no point in anything anymore",
    "I want to disappear forever",
    "I wish I didn't exist",
    "I wish I'd never been born",
    "I hate being alive",
    "I can't go on like this",
    "I can't keep living like this",
    "there's no way out",
    "I can't take this anymore",
    "life is pointless",
    "honestly what's the point of any of this, I just want to disappear",
    # Hinglish / Hindi (romanised)
    "mujhe jeena nahi hai",
    "mar jana chahta hu",
    "mar jaana chahti hoon",
    "main marna chahta hoon",
    "khudkushi kar lunga",
    "aatmahatya ke baare mein soch raha hu",
    "jeene ka mann nahi karta",
    "zindagi khatam karna chahta hu",
]

NEGATIVES = [
    "this assignment is killing me",
    "this assignment is killing me lol",
    "my back is killing me",
    "killing it today!",
    "you killed it in the presentation",
    "I could die of embarrassment",
    "I'm dying of boredom in this lecture",
    "dying to know my marks",
    "the battery is dead",
    "my phone died",
    "kill -9 the process",
    "how do I kill the server on port 3000",
    "kill this bug",
    "killing time before class",
    "dead tired after the lab",
    "I'm dead lol 😂",
    "my deadline is tomorrow",
    "this lecture is deadly boring",
    "this exam will be the death of me",
    "the plant died",
    "I want to end this chapter today",
    "end the session",
    "end of the semester",
    "stop the timer",
    "I want everything to be done by Friday",
    "kill two birds with one stone",
    "I'm not suicidal, just really tired",
    "I'm a hopeless romantic",
    "I'm hopeless at maths",
    "writing an essay on suicide prevention",
    "psych assignment about self-harm awareness campaigns",
    "Suicide Squad is on tonight",
    "I can't do this question",
    "I need a break",
    "everything is too much right now",
    "I'm so overwhelmed",
    "ugh I hate this assignment",
    "i'm drowning in work",
    "I want to disappear into a book for a while"
]


@pytest.mark.parametrize("text", POSITIVES)
def test_positive(text):
    assert classify(text), text


@pytest.mark.parametrize("text", NEGATIVES)
def test_negative(text):
    assert classify(text) is None, text


def test_set_is_large_enough():
    assert len(POSITIVES) + len(NEGATIVES) >= 60
