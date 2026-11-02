# Eval notes

What the 38 cases are, and the cases that did not pass in the full run on Claude Sonnet 4.6 (2026-11-02, 32 of 38). The headline numbers are in the [README](../../README.md#evals); every case's answer and cost is in [latest.md](latest.md).

## The cases

The 38 cases are the 24 of the first run (15 core cases: 5 lookups, 3 comparisons, 3 storylines, 2 prompt-injection cases, a refused request for a customer's email, a Tidepool user asking about Solenne; 5 "why did we miss plan" cases, one per planted storyline and one month where nothing was planted; the 3 Pace cases; a landing-page case) and 14 added since: cohorts, payback, "how much a day do we need", invoices, a document question, a call note, the Tidepool audit, two promo post-mortems, customer segments, bundles, a launch curve and two playbooks. All five of the newest analysis cases pass.

## The six that did not pass

- `mer-last-month`: the answer was right (MER 2.00) but it explained it as "for every $1 of ad spend, $2.00 of net sales", and the checker correctly refused those two dollar figures because no tool returned them. It failed the same way in the first run.
- `compare-may-aov-wholesale`: both figures were right ($143.12 for all orders, $81.47 excluding wholesale), but the grader did not take "All orders" as the with-wholesale label. The grader was fixed and tested offline; the case has not been re-run live.
- `playbook-retention-check`: the figures were right ("22.2% of new customers placed a second order within 60 days"), but the grader looked only for "repeat" or "ordered again" after the percentage. The grader was fixed and tested offline; the case has not been re-run live.
- `storyline-s4-barrier-refunds`: a real miss. The model filtered to one variant, the 100 ml jar, and reported that variant's refund rates (16.7% in May, 25.0% in June) instead of the product's (1.3% and 15.2%).
- `why-july-fig-sellout` and `why-april-nothing-planted`: real misses, not yet triaged. July's write-up named a Lip Balm SPF 15 gap rather than the planted Lip Tint in Fig sell-out, and April's blamed a Peptide Firming Serum stock-out in a month where nothing was planted. Whether the cause is the prompt, the data pack or model variance has not been separated (see issue #22).

## Other models

The same suite on Devstral 2 passed 10 of 24 before the prompt fixes made after that run, so the model matters: Devstral's failures were mostly mislabelled figures (a store-wide refund total presented as one product's) and weak tool choices, not wrong numbers that slipped past the checker. The run does not depend on the day it is made or on the live store.
