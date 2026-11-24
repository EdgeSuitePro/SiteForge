# ESP Website Opportunity Score

An internal EdgeSuite Pro measure of how well a website helps a sharpening business get found and win
customers. **It is not an industry-standard SEO score**, and the UI says so.

## Principles

- **Rules, not opinions.** Every point comes from a named, versioned rule in `src/core/audit/rules/`
  (ruleset `esp-audit@1`). No language model decides a score. (Phase 4's AI review will contribute
  through a fixed rubric with capped weight, mapped to points by code.)
- **Evidence.** Each finding stores what was observed, the evidence (page, snippet, locator), why it
  matters, and the recommended fix.
- **Missing data is not a failure.** A rule that does not apply (e.g. "tap-to-call" when no phone exists)
  or cannot be assessed is excluded from the denominator and listed as *not assessed*.
- **Operator decisions count.** Rejected facts are ignored by the audit. When facts change after an
  audit, the audit is marked stale until it is re-run.
- **Opportunities are never assumed.** Revenue opportunities (commercial accounts, mail-in, seasonal
  tools, specialty work, gift cards) are reported as *Potential opportunity — requires owner
  confirmation*, score 0 points, and are never added to concepts automatically.

## Calculation

- Each rule has points (2–6) and a severity (high/medium/low). Outcomes: pass (all points), partial
  (a fraction, severity one level lower), fail (0), not applicable / unknown (excluded).
- **Category score** = points earned ÷ points possible over assessed rules × 100.
- **Overall** = weighted average of category scores: Visibility 20, Clarity 15, Trust 15,
  Conversion 20, Customer experience 15, Local relevance 15. Revenue opportunities: 0 (unscored).
- Findings are ordered by severity × points lost.

## AI-assisted questions (Phase 4)

A fixed rubric (`semantic-audit@1`, 13 questions) covers judgement calls the automated checks cannot
make (is the purpose obvious, is the copy customer-focused, is the process understandable…).

- The model rates each question yes / partly / no / cannot assess and must quote the site. Code turns
  ratings into points (yes = full, partly = half, no = 0); cannot assess is excluded.
- A yes/partly answer with no verified quote becomes *unknown* (excluded), so invented praise cannot raise a score.
- Within each category, AI questions are scaled so they make up **at most 40%** of points possible.
- Mock-provider answers are shown separately and score 0 points.
- The audit stores the rubric version and the model run; changing a question or its weight bumps the version.

## Changing rules

Any change to a rule, weight or threshold bumps `RULESET_VERSION`. Audits store the version that
produced them, so historical scores remain attributable. Add a test for every new rule.
