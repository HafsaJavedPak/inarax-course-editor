# Demo: workspaces, sharing, history and live co-editing (local)

A walkthrough to show multi-tenancy and collaboration and change control on one machine, with
made-up people in made-up organizations. No InaraX needed.

## Start (two terminals)

```bash
npm run dev:launch     # pretend InaraX on http://localhost:3002: sign in as test people
npm run dev:demo       # the editor on http://localhost:3001, trusting that pretend InaraX
```

`.env.local` needs the live-editing lines (`COLLAB_EMBEDDED=1`, `COLLAB_PORT=1234`,
`COLLAB_PUBLIC_URL=ws://localhost:1234`, `COLLAB_TICKET_SECRET=…`). `dev:demo` turns publishing off
(these people don't exist on a real InaraX).

**Two people at once:** each browser window keeps one sign-in, so use a **normal window** for one
person and a **private/incognito window** (or another browser) for the other. Open
http://localhost:3002 in each and click a name. To switch someone, click another name in the same
window.

| Person | Who they are |
|---|---|
| Alice | creator in **Acme Learning** |
| Erin | another creator in Acme |
| Dave | **admin** of Acme (reviews Acme's courses) |
| Carol | creator in **Beta Academy** |
| Mo | creator in Acme *and* admin of Beta |
| Bob | no organization, personal workspace only |
| Sam | InaraX staff (reviews personal-workspace courses) |
| Alice (left) | Alice after being removed from Acme |

## 1 · Multi-tenancy: workspaces are kept apart

1. **Window A, Alice.** The workspace switcher (top left) shows *Alice's workspace* and *Acme
   Learning*. Open Acme and create a course ("Acme onboarding"). Copy its address from the address
   bar.
2. **Window B, Carol (Beta).** Her switcher has no Acme. Paste Alice's course address: **not
   found**. The editor doesn't even confirm the course exists.
3. **Window B, Erin (Acme creator).** She's in Acme, but creators only see their own courses: Alice's
   course is still **not found**, and it isn't in her Acme list.
4. **Window B, Dave (Acme admin).** Alice's course is in his Acme list and under **Course reviews**.
5. **Window B, Mo.** Two workspaces, with a different role in each.
6. **Window B, Alice (left).** The Acme workspace is gone. Removing someone from an organization on
   InaraX removes their access here at their next sign-in.
7. On http://localhost:3002, **access changed** next to a name ends that person's editor sessions at
   once (their next click asks them to sign in).

## 2 · Sharing (phase 1)

1. **Alice:** open "Acme onboarding", click **Share**, add **Erin** as **Editor**.
2. **Erin:**
   - the course is now in her Acme list;
   - she can edit lessons and the outline;
   - the **Settings** page is read-only for her ("only the course's owners …");
   - she can't share it or submit it.
3. **Alice:** change Erin to **Viewer**. Erin, after a refresh, can only read.
4. **Outside guests.** Alice invites `dev-carol@example.test`: **refused**, because organizations
   allow no outside guests by default.
   1. **Dave** (Acme admin) opens the Acme workspace page and ticks *Courses here can be shared with
      people outside this organization*, as at most **commenter**.
   2. **Alice** invites `dev-carol@example.test` as **Commenter**, then copies the link.
   3. **Carol** opens the link, sees who invited her and as what (not the course), and clicks
      **Accept**.
   4. The course opens read-only, and it's under **Shared with me**. She sees nothing else of Acme.
   5. **Dave** unticks the setting: Carol's access sleeps (the course is not found). Ticking it again
      brings it back.
5. **Wrong account:** the same link opened by anyone else says *This invitation was sent to a different account.*

## 3 · Live co-editing (phase 4)

1. **Alice and Erin** (Erin as **Editor**) open the **same lesson**, one per window.
2. Type in one window: it appears in the other within a moment. Both type at the same time: both
   texts are kept.
3. Each sees the other's avatar at the top, and a coloured outline with their name on the block
   they're in. The save bar shows **Saving…**, then **All changes saved** (stored in the database).
4. **Revoke live:** Alice removes Erin in **Share**. Within seconds Erin's editor says she no longer
   has access.
5. **Read-only live:** make Erin a **Viewer** instead. Her lesson becomes read-only; nothing she
   types goes through.

## 4 · History and change control (phases 0 and 2)

1. Edit a lesson a few times, then open **History** from the course builder:
   - each version shows who changed it, when, and what changed in words;
   - one person's continuous typing is one version;
   - live editing with someone else gives a version with both names.
2. Click an old version:
   - **What changed in it** shows the word-level changes;
   - **What restoring it would change** compares it with now.
3. **Restore this version.** It becomes the newest version (*Restored from version N*), and
   everything after it is still listed. Anyone editing that lesson live is asked to reload it.
4. **Save version** names the current version (for example "Before the rewrite").
5. **Review binding:**
   1. A course goes to review with **Submit for review**. The course must first pass the checks
      (every planned lesson written, word counts, every level used), and the panel lists what's
      missing.
   2. After submitting, **Dave** sees *Reviewing version N* on the review page. His decision is
      recorded against exactly that version. If anyone changes the course while he's looking, his
      decision is refused, and he's asked to reload.
   3. After acceptance, an edit by the author sends the course back to draft and withdraws the
      acceptance. The history shows *Acceptance withdrawn by this edit*.

## 5 · Personal workspaces and staff

- **Bob** has only a personal workspace; his courses are his alone.
- **Sam** (InaraX staff) reviews courses written in personal workspaces, never organizations'.

## Back to signing in through InaraX

Stop `dev:launch` and `dev:demo`, then start the editor normally on port 3001
(`npm run dev -- -p 3001`) next to InaraX on port 3000, and use **Course editor** in InaraX.
