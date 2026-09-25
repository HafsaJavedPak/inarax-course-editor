# Authoring an interactive lesson

There are three other files in this folder.

**engine-reference.md** describes the lesson format the platform uses: the components a lesson can
be built from — text, flip cards, tabs, timelines, multiple choice, drag-into-buckets and the rest
— and the exact shape each one has to take. It is written for an AI to read, not for you.

**authoring-prompt.md** is the instruction you hand to the AI. It tells it to produce a finished
lesson rather than a plan, and it carries the rules about quality: keep the answer options the same
length so the longest one isn't always the right one, don't give the answer away in the paragraph
directly above the question, keep examples out of any one industry, aim for ten to twenty minutes.

**lesson-input-template.md** is the one you fill in. The title, who it's for, what the learner
should be able to do afterwards, the key concepts, and the actual material you want taught —
including the correct answers to anything you want checked.

## How to make a lesson

Write your lesson into the template. Anything you leave out won't appear in the finished lesson, so
put the real content in rather than a summary of it.

Open ChatGPT or Claude and send one message containing three things: the whole of
`authoring-prompt.md`, the whole of `engine-reference.md`, and your filled-in template pasted at the
bottom, where the prompt says "Lesson Content".

It replies with a block of JSON. Copy it. You don't need to read it or understand it.

In the admin, open the lesson builder, go to your lesson, click **Import JSON** and paste it in,
then **Validate**. You'll get either a tick or a list of what's wrong. If it's the list, paste that
straight back to the AI and ask it to fix it — that usually takes one round. Then **Import to
canvas**.

Before you save, open the **Preview** tab and go through the lesson the way a learner would,
checking the answers as you go. Validation only proves the JSON is well formed; it cannot tell you
the AI marked the wrong option as correct, and sometimes it does. It saves as a draft, so nobody
sees it until you approve it.
