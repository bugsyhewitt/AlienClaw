# Packet 30 — install.sh Fix Diagnosis

## Symptom

CI failing since 2026-05-10. Both TypeScript typecheck and Unit tests jobs fail at
"Install dependencies" (`npm install`). Python lint job fails at ruff check.

---

## Root cause A — npm `"install"` lifecycle hook (the primary L4 bug)

**File:** `package.json`

```json
"scripts": {
  "install": "bash install.sh"
}
```

npm treats `"install"` as a lifecycle hook that runs automatically on every
`npm install` invocation. The CI `typescript` and `test` jobs run `npm install`
to install dev dependencies (typescript, vitest), not to run the AlienClaw
installer. But `"install"` fires unconditionally.

`bash install.sh` checks for the `openclaw` binary. In CI, openclaw is not
installed in the `typescript` or `test` jobs (only the `install-smoke` job
installs it first). So install.sh exits 1, failing `npm install` entirely.

**When this was introduced:** The `"install": "bash install.sh"` script was
presumably added to support `npm install` as an alternative to `bash install.sh`
directly. However, this is a misuse of the npm `"install"` lifecycle key — it's
appropriate for binary compilation during package installation as a dependency,
not for application-level setup scripts.

**The fix:** Rename `"install"` to `"setup"` in package.json scripts.

- `npm install` → installs dev deps, does NOT trigger install.sh ✓
- `npm run setup` → runs install.sh explicitly (for users who want this path) ✓
- `bash install.sh` → still works directly (unchanged, the canonical install method) ✓

---

## Root cause B — Python ruff failure (secondary CI failure)

**File:** `src/alienclaw/brains/decoder.py` (committed state at 3bdcc90f)

The committed version of decoder.py had:
- `I001`: import block unsorted
- `E501`: line too long (107 chars) — `from alienclaw.genome.alphabet import SECTION_IDENTITY, SECTION_EXECUTION, SECTION_BEHAVIOR, SECTION_LENGTH`

The locally modified version of decoder.py (from Packets 14+ development arc,
not yet committed) already passes ruff — those changes reformatted the imports.
Including the locally modified decoder.py in the L4 commit fixes the Python ruff job.

**The fix:** Include decoder.py in the L4 commit — the local version already passes ruff.

---

## Verification

After fix applied locally:

```
npm install → exits 0 (no install.sh triggered)
tsc: present (dev dep installed)
vitest: present (dev dep installed)
python3 -m ruff check src/alienclaw/brains/decoder.py → "All checks passed!"
```

CI verification: pending push — CI green run required to close L4.

---

## Fix scope

| Change | File |
|--------|------|
| Rename `"install"` → `"setup"` in scripts | package.json |
| Include locally-modified (ruff-clean) brains file | src/alienclaw/brains/decoder.py |
