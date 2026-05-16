# Packet 29 — Legal Audit

Audit date: 2026-05-16. Clean clone at /tmp/alienclaw-audit-20260516-170016.

---

## License

### Is there a LICENSE file?

**Yes — but it is effectively empty.**

```
ls -la /tmp/alienclaw-audit-20260516-170016/LICENSE
-rw-rw-r-- 1 xil xil 1 May 16 17:00 LICENSE

xxd /tmp/alienclaw-audit-20260516-170016/LICENSE
00000000: 0a   .
```

The LICENSE file contains exactly one byte: a newline character. No license
text. No SPDX identifier. No copyright statement. Nothing.

### What does GitHub show?

GitHub's API reports the license as:
```json
"license": {
  "key": "other",
  "name": "Other",
  "spdx_id": "NOASSERTION"
}
```

GitHub detected *something* (the file exists) but cannot identify the license
because there's no recognizable license text. NOASSERTION means "we can't tell."

### What does the website claim?

The footer of `alienclaw.net` states:

> "AlienClaw is free and open source under **MIT**. Hosted on Hostinger."

It links to: `https://github.com/AlienTool/AlienClaw/blob/main/LICENSE`

Clicking that link shows a 1-byte file. The MIT claim is false as of this
audit — there is no MIT license text in the file.

The README also says "See [LICENSE](./LICENSE)" — same empty file.

---

## Legal consequence

Without a valid license, the default legal position is **all rights reserved**.
This means:
- Strangers cannot legally *use* the code for their own purposes
- Strangers cannot legally *copy* or *distribute* the code
- Strangers cannot legally *fork* or *contribute* to the project
- No contributor can safely submit a PR (they don't know if they retain rights)

This applies regardless of the repo being public. "Public" means visible, not
freely licensed.

The gap between what the website claims (MIT) and what the file contains
(nothing) creates legal confusion and could be used to argue the *intent*
is MIT — but intent is not a license. The text must be present.

---

## Third-party code and attribution

Notable: `package.json` lists `@mariozechner/pi-ai` as a dev dependency.

```json
"@mariozechner/pi-ai": "0.73.0"
```

This appears to be a package by Mario Zechner (of libgdx fame or a different
author). Whether this package is under a license compatible with MIT (or
whatever AlienClaw intends to use) is not verified in this audit. The package
name suggests it may be personal/experimental software.

The package.json `private: true` means AlienClaw cannot be published to npm
as-is, which is appropriate.

---

## Other attribution considerations

- `openclaw` (MIT) — AlienClaw is built on top of OpenClaw. Attribution is
  implicit (OpenClaw is a prerequisite, not vendored), so no file-level
  attribution is needed.
- No other vendored code detected in the clean clone.

---

## Gaps found

| Gap | Severity | Notes |
|-----|----------|-------|
| LICENSE file is empty (1 byte) | **LAUNCH-BLOCKER** | Nobody can legally use, fork, or contribute without a valid license |
| Website claims MIT but LICENSE file is empty | **LAUNCH-BLOCKER** | False statement on the public site; creates legal confusion |
| `@mariozechner/pi-ai` license compatibility unverified | standard-hygiene | Should verify this dep's license is compatible with intended AlienClaw license |
