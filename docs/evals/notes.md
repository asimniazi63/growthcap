# Eval notes

What the 41 cases are, and the cases that did not pass in the latest full run on Claude Sonnet 4.6 (2026-11-03, 35 of 41; the run before it, on 2026-11-02, passed 32 of 38). The headline numbers are in the [README](../../README.md#evals); every case's answer and cost is in [latest.md](latest.md). That run was made on the code as it stood before the last change to the Creative briefs question; only the creative case has been run since (below).

## The cases

The 41 cases are the 24 of the first run (15 core cases: 5 lookups, 3 comparisons, 3 storylines, 2 prompt-injection cases, a refused request for a customer's email, a Tidepool user asking about Solenne; 5 "why did we miss plan" cases, one per planted storyline and one month where nothing was planted; the 3 Pace cases; a landing-page case) and 17 added since: cohorts, payback, "how much a day do we need", invoices, a document question, a call note, the Tidepool audit, two promo post-mortems, customer segments, bundles, a launch curve, two playbooks, two EBITDA cases and the Creative briefs case. Both EBITDA cases pass, and so do four of the five analysis cases (the promo post-mortems, segments, bundles and launch curve); `postmortem-vipglow25` is the one that did not this time.

## The six that did not pass

- `mer-last-month`: it failed the same way as in the two earlier full runs. The answer was right (MER 2.00) but it explained it as "for every $1 of ad spend, the store generated $2.00 in net sales", and the checker correctly refused those two dollar figures because no tool returned them.
- `compare-may-aov-wholesale`: the answer was right again ($143.12 for all orders including wholesale, $81.47 excluding it), but the grader did not accept it. The answer was a table whose rows put the order count (96 and 95) between the label and the figure, and the grader's pattern does not allow a digit between them. The grader is not fixed for that layout.
- `storyline-s4-barrier-refunds`: a real miss again. The model filtered to one variant, the 100 ml jar, and reported that variant's refund rates (16.7% in May, 25.0% in June) instead of the product's (1.3% and 15.2%).
- `why-april-nothing-planted`: a real miss again, not yet triaged. The write-up blamed a Peptide Firming Serum stock-out in a month where nothing was planted. Whether the cause is the prompt, the data pack or model variance has not been separated (see issue #22).
- `postmortem-vipglow25`: new this time (it passed in the run of 2026-11-02, 13 of 13 checks). The write-up gave the lift as "18.0% above expected net sales", a share the model worked out, and counts (2, 4 and 5) that no tool returned, and the checker refused them. The case scored 12 of 13 once before, on a different figure ("16.7 percentage points"), which the checker was changed to read.
- `creative-briefs-black-friday`: 31 of 33 checks, on the wording of the question before its last change. The answer began by writing a what-if's money, which is in cents, as dollars ($59,866 for $598.66), caught itself in the visible text ("I need to re-check the exact figures...") and wrote the briefs again, quoting the calendar's "40%" on the way. Two checks failed: a digit in a quoted line, and figures no tool returned ($59,866, 8675 and 40%). The question was then changed to ask the what-ifs for their profit margins only, and the case has passed twice since (below). The full set was not re-run after that change.

## Two that passed this time

- `why-july-fig-sellout` passed (it named the Lip Tint in Fig sell-out). It failed in the run of 2026-11-02 and nothing was changed for it, so this is model variance, and the miss has still not been triaged.
- `playbook-retention-check` passed. Its grader was fixed after the last run, and the answer is worded as before ("22.2% of new customers placed a second order within 60 days of their first"), which the old grader missed and the fixed one accepts. This is the first live run to show the fix works.

## The Creative briefs case on its own

It is the newest case and the one that was changed most, so its live record is kept here. It has had eight paid runs on 2026-11-03 (Claude Sonnet 4.6, $2.74 in all, $0.23 to $0.46 a run). It passed on run 5 (31 of 31 checks, on an earlier wording of the question) and on runs 7 and 8 (38 of 38 each, on the final wording, each after one repair turn), and it failed on runs 1 to 4 and run 6. Runs 1 to 4 failed on a percentage quoted from a calendar entry, a price lever written as 0.25, money in cents written as dollars (twice) and, in one, a brief led with the 30 ml serum. Run 6 led a brief with the 30 ml serum it had listed under Not pushing. Two passes in a row on the final wording is a tiny sample, so a run can still be Blocked on the page, and a retry costs about $0.34. From the next full run, `latest.md` says when a case used the repair turn.

Follow-up, not done (Asim's call): both final passes needed a repair turn, and the retry prompt (`repairInstruction`, shared by every agent run) does not tell the model to leave the flagged figures out of its rewrite, so a model that mentions them again is blocked again. A one-sentence change there is logically safe but shared, so it needs a full eval (about $6.3).

## Other models

The same suite on Devstral 2 passed 10 of 24 before the prompt fixes made after that run, so the model matters: Devstral's failures were mostly mislabelled figures (a store-wide refund total presented as one product's) and weak tool choices, not wrong numbers that slipped past the checker. The run does not depend on the day it is made or on the live store.
