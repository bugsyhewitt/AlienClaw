# License options (gate G11): decision input, not a decision

**No LICENSE file has been chosen for the public repository, and this skeleton contains
none.** The owner picks. This file stays in the source repository and is not imported.
Not legal advice.

The staged code is under the source repository's terms today: MIT, with the copyright line
"Copyright (c) 2026 Bugsy Hewitt". Both staged manifests say `MIT` (`python/pyproject.toml`
`license = "MIT"`, `ts/package.json` `"license": "MIT"`), with a comment that the release
license is still open.

## The two options (plan §6)

| | **MIT** (keep as is) | **`MIT OR Apache-2.0`** (dual) |
|---|---|---|
| What users get | MIT's terms | Their choice of either license |
| Patent grant | None explicit | Apache-2.0 §3 grant and patent retaliation, for users who choose it |
| Incoming contributions | Licensed implicitly; a DCO sign-off makes it explicit | Apache-2.0 §5 licenses contributions by default |
| GPLv2-only compatibility | Yes | Yes, through the MIT side |
| Corporate legal review | Universally accepted | Often preferred (explicit patent terms) |
| Comparable libraries | npm `ssrf-guard`, `request-filtering-agent` | PyPI `ssrfguard`, `advocate` use Apache-2.0 alone |
| Effort | None: already on the code | Two license files, an SPDX expression, a sentence in the README |

The plan recommends **`MIT OR Apache-2.0`**: the patent risk for address-range and path
checks is realistically negligible, so the gain is corporate comfort and explicit
contribution terms, which matter for the people this library is meant to reach. Its second
choice is **MIT as is**, which is completely acceptable and costs nothing. Apache-2.0 alone
is also possible; it adds NOTICE handling and loses GPLv2-only compatibility, and the plan
does not recommend it.

## What each option needs at import

Two packaging facts decide the file layout for either option:

- **PEP 639 `license-files` paths are relative to `python/` and may not leave it**, so the
  Python package needs its own copy of every license file (a symlink does not survive an
  sdist reliably).
- **npm packs a `LICENSE*` file only from the package directory** (`ts/`), whatever `files`
  says.

So every license file exists three times, at the root, in `python/` and in `ts/`, as
byte-identical copies. The proposed CI checks that (`codegen-drift`, "Package license copies
equal the root ones"), and both package-smoke jobs fail if the built wheel or tarball
carries no license file.

### MIT

- `LICENSE` (the MIT text with `<<COPYRIGHT_LINE>>`) at the root, in `python/` and in `ts/`.
- `python/pyproject.toml`: `license = "MIT"` and `license-files = ["LICENSE"]`.
- `ts/package.json`: `"license": "MIT"`.

### MIT OR Apache-2.0

- `LICENSE-MIT` (with `<<COPYRIGHT_LINE>>`) and `LICENSE-APACHE` (the unmodified Apache
  License 2.0 text) at the root, in `python/` and in `ts/`. Optionally a `NOTICE` file with
  the copyright line, copied the same way; Apache-2.0 asks redistributors to keep it if
  present.
- `python/pyproject.toml`: `license = "MIT OR Apache-2.0"` and
  `license-files = ["LICENSE-MIT", "LICENSE-APACHE"]` (plus `"NOTICE"` if added). Do not add
  `License ::` trove classifiers: with a PEP 639 expression, setuptools 77+ rejects them.
- `ts/package.json`: `"license": "(MIT OR Apache-2.0)"`, the parenthesised SPDX form the
  npm documentation uses for a choice of licenses.
- README: "Licensed under either of MIT or Apache-2.0, at your option", and the usual
  sentence that contributions are dual-licensed the same way unless stated otherwise.

## Confirm before choosing (either option)

- [ ] The copyright line: `<<COPYRIGHT_LINE>>` (today "Copyright (c) 2026 Bugsy Hewitt").
- [ ] A conscious yes to holding the copyright of code largely written by AI coding agents
      under the owner's direction. This does not block an open-source license.
- [ ] Provenance: no third-party code was copied into the IPv6 parsing, the block-list
      matching or the boundary code. The source-commit mapping kept in the source repository
      (`PROVENANCE.json`, private) is the record to check against.
- [ ] Contribution terms in `CONTRIBUTING.md`: DCO or CLA (`<<DECISION>>` there).
