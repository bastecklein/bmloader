# Working in this repo

Instructions for AI assistants — and for anyone who wants to know how this
project is worked on. Read this before the code.

## Orient before answering

Do not infer what this project is from the folder name, or from this file alone.

1. Read `README.md` — what it is and how to run it.
2. Read `TODO.md` — what is left to do, and any open questions.
3. Check `documentation/`. Neither file below is created in advance, so it may
   be absent — that means "nothing written down yet", not "no design":
   - `documentation/decisions.md` — why things are the way they are. Append-only
     and chronological, so search it rather than reading it end to end:
     `grep -n "keyword" documentation/decisions.md`
   - `documentation/implementation-plan.md` — current design intent, if a plan
     is being kept.
4. Read the actual source before relying on any API. Do not guess a function
   signature, field name, or config key. If you cannot find it, say so.

If these files contradict each other, say so instead of silently picking one.

## If the docs are still placeholders, this is a new project

Check this before starting work, because it changes what you should do next.

**The signal is both of these together:**

1. `README.md` still contains its placeholder comments — the `<!-- ... -->`
   blocks describing what to write, and `OPEN:` markers where intent should be.
2. None of `documentation/decisions.md`, `documentation/implementation-plan.md`,
   or `TODO.md` has real content. A file that does not exist yet counts as
   having no content.

Both are required, and that matters. A mature project can perfectly well have a
placeholder README: a project with 200 KB of decisions and a two-line stub for a
README is common enough, because the README is usually the last thing anyone
writes. Judging by the README alone would call that project new and start
interviewing you about work you finished a year ago.

An empty `decisions.md` on its own means nothing either: most projects never
recorded decisions. It only counts as evidence together with the README.

When the project is new, do not draft a spec, a README, or code from your own
assumptions. Instead:

1. **Interview, one question at a time.** Ask a single question, wait for the
   answer, then ask the next. A wall of ten questions gets skimmed and
   half-answered.
2. **Ask about intent, not facts you can read.** Do not ask what the project is
   called — it is in `package.json`. Ask what it is for, who uses it, what
   "done" looks like, and what is explicitly out of scope.
3. **Write decisions down as they are made, not at the end.** The moment
   something is settled, create `documentation/decisions.md` and append it with
   its reasoning. A confirmed decision held only in chat dies with the chat.
4. **Leave what is unresolved marked `OPEN:`** in the relevant file. Do not
   close an open question by quietly picking the most plausible answer.
5. **Stop when you can state the goal, the non-goals, and a first milestone.**
   Summarise what is established and what is still open, and ask before you
   begin drafting docs or writing code.

**Exception — do not interrogate.** If the user's opening message already says
what to build, discovery is already done. Confirm your understanding in a
sentence or two, write it down, and ask about genuine gaps only. Discovery is
for when intent is not yet established — it is not a gate on every first message.

## How work is written down

| File | Kind | Allowed |
| --- | --- | --- |
| `README.md` | current truth | edit |
| `documentation/decisions.md` | chronological history | **append only** — create when there is something to record |
| `documentation/implementation-plan.md` | current design intent | edit — create when there is a plan worth keeping |
| `TODO.md` | open problems | edit, and prune when done |

Something true *now* does not go in `decisions.md`. That file records *why*,
permanently, in order. Never rewrite or delete an entry in it; to supersede one,
append a `**Resolved (DATE):**` paragraph and leave the original intact.

**Neither file is created in advance, and neither should be created empty.**
Create one the moment you have its first real entry. A placeholder file that
nobody fills is worse than no file at all: it looks like documentation, so the
next reader stops looking.

### Recording a decision

**Create `documentation/decisions.md` as soon as a design decision is settled.**
A confirmed decision held only in chat dies with the chat, and this is the one
thing neither the code nor the git history can tell the next reader. Entries:

    ## YYYY-MM-DD — <the decision, stated as one line>

    **Decided:** what we chose.

    **Why:** the reasoning that would otherwise be lost — the part that cannot
    be re-derived from the code later, so it is the part that matters.

- **Append only, newest last.** Never rewrite or delete an earlier entry. A
  decision that looks wrong today is usually how the current design was reached,
  and the next reader needs to know that.
- **Superseding is an append, not an edit.** Add a `**Resolved (YYYY-MM-DD):**`
  paragraph to the old entry pointing at the new one; leave the original intact.
- **Current state does not belong here.** If something is true *now*, it goes in
  `README.md` or the implementation plan. Nobody should have to read to the
  bottom of this file to learn what is true today.
- **Record what was not obvious.** The test is whether the reasoning would be
  lost if this file did not exist.
- **Date the entry when the decision is made**, not when it is written up.

### Recording a plan

**Create `documentation/implementation-plan.md` only while the project is
actively being built.** It is forward-looking, and its value is concentrated in
the parts that stop guessing:

- **Goal** — one paragraph: what exists when this is done, and how you would know.
- **Non-goals** — explicitly out of scope. Cheap to write, and it stops scope
  creep in review and stops an assistant from helpfully building the wrong thing.
- **Milestones** — for each: what "done" means, and how it will be verified. A
  milestone that cannot be verified is a wish.
- **Open questions** — unanswered, and who or what would answer them. Add them
  here rather than guessing, and re-read this section before starting work.
- **Risks** — what could sink this, and the earliest cheap test of each.

A project that is finished and frozen does not need this file at all. A stale
plan is worse than none.

## Before saying you are done

- Run the tests (`npm test`, or a fast subset while iterating) and report the
  actual result. If you could not run them, say that plainly rather than
  implying they passed.
- Keep diffs small and matched to the patterns already in the code. Ask before
  starting a refactor.
- Report what changed, where, and anything you were unsure about.

## Do not

- Do not invent requirements, APIs, or file contents. Mark unknowns `OPEN:`.
- Do not treat a placeholder as a statement. A stub `README.md` or an empty
  `decisions.md` means nothing is written down yet — not that there is no
  design, and not that the answer is "nothing".
- Do not add a dependency, change the build, or touch deployment without asking.
