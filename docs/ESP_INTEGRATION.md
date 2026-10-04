# SiteForge → EdgeSuite Pro integration boundary (draft)

SiteForge and EdgeSuite Pro share **no database and no code**. They communicate through a versioned,
documented contract.

```
SiteForge prospect → audit → concepts → chosen concept → handoff → ESP onboarding
```

## Contract: `siteforge.esp-handoff.v1` (to be defined in `src/core/contracts/` with Zod + JSON Schema)

- **Prospect identity** — business name, website domain, known contact, operator notes.
- **Verified facts only** — each with source URL, evidence snippet, extraction method.
- **Audit summary** — ruleset version, category and overall scores, top findings.
- **Chosen concept** — strategy, content document, design tokens, renderer version.
- **CTA intents** — `reserve`, `call`, `text`, `drop_off`, `mail_in`, `contact`; ESP binds them to its own endpoints.
- **Consent records** — who approved migration and asset use, and when.

## Transport (later phase)

- SiteForge `POST`s the handoff to an ESP onboarding endpoint, HMAC-signed, with an idempotency key and
  timestamp (replay protection). ESP replies with its `business_id`, stored on the prospect.
- ESP can re-fetch via a read-only `GET /api/esp/v1/handoffs/:id`.
- ESP never writes to SiteForge's database.

The contract maps naturally onto ESP's business profile (name, phone, email, address, timezone) and
service catalog, but intentionally does not mirror any tenant's table names.
