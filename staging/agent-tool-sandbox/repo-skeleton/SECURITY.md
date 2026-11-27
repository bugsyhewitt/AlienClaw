# Security policy

This repository ships security controls: an SSRF guard with connection pinning and a
filesystem jail for LLM-agent tools, in Python (`<<PYPI_NAME>>`) and TypeScript
(`<<NPM_NAME>>`). A way around one of them is a vulnerability. Please report it privately.

It is maintained by one person. The targets below are honest, not contractual.

## Supported versions

While the project is in `0.x`, only the latest minor release gets security fixes. MAJOR.MINOR
moves in lockstep across both languages and equals the block-list policy and corpus version,
so the same row covers both packages.

| Version | Python (`<<PYPI_NAME>>`) | TypeScript (`<<NPM_NAME>>`) | Security fixes |
|---|---|---|---|
| latest `0.MINOR.x` | yes | yes | yes |
| older `0.x` minors | no | no | no: upgrade to the latest minor |
| anything before `0.1.0` | not released | not released | no |

Runtimes: Python versions that still get upstream security fixes (3.11 and later at launch)
and Node.js LTS lines (22 and 24 at launch). Linux and macOS are tested. Windows is not, and
the filesystem jail refuses to run there.

## Reporting a vulnerability

Use one of these, not a public issue, pull request or discussion:

1. **GitHub private vulnerability reporting** (preferred): the "Report a vulnerability"
   button on the Security tab, or `<<REPO_URL>>/security/advisories/new`.
2. **Email:** `<<SECURITY_CONTACT>>`.

Please include:

- the package, version (or commit) and runtime (Python or Node version, OS);
- the input: the URL, the resolver answers, the redirect chain, or the path and the
  directory layout;
- what you expected the documented guarantee to do, and what happened instead;
- whether the other language behaves the same way (if you can check);
- a minimal reproduction. A new entry for one of the shared vector files in `vectors/` is
  the ideal form, because it becomes the regression test for both languages.

Please do not test against systems you do not own. Every reproduction this project needs can
run against a fake resolver or a listener on `127.0.0.1`.

## What happens next

| Step | Target |
|---|---|
| Acknowledge the report | within 7 days, best effort |
| Fix or mitigation for a critical issue | aim for 30 days |
| Fix for other in-scope issues | best effort, in a later release |

Fixes are released for both languages at once when both are affected. Advisories are
published as GitHub Security Advisories, with a CVE requested where one applies, and they
credit the reporter unless you ask otherwise.

**Coordinated disclosure:** the default is 90 days from the report, or the release of the
fix, whichever comes first. We can agree on a different date, for example when a fix needs
an upstream change in a runtime.

## Scope

**In scope: a bypass of a documented guarantee.** The guarantees are what the package READMEs
list under "Covered", what `policy/blocklist.v1.json` says each language blocks, and what the
recorded verdicts in `vectors/` assert. Examples:

- **SSRF guard:** an input the documentation says is refused, but which reaches an address in
  a blocked range: an IP spelling, a host name, an IDNA form, a URL parser differential, a
  DNS answer, a redirect hop, an IPv6 transition form that embeds a blocked IPv4.
- **Connection pinning:** a request through the pinned API (`pinned_urlopen` and the pinned
  openers and connections in Python, `hardenedFetch` in TypeScript) whose socket connects to
  an address other than the validated one, or that resolves the name a second time.
- **Limits:** a total deadline or size cap that does not hold where the README says it does
  (for example a slow-drip body that outlives the deadline).
- **Redirects:** a hop that skips re-validation, an https to http downgrade where the
  documentation says it is refused, or credentials sent across origins where the
  documentation says they are dropped.
- **Filesystem jail:** a path that escapes the root, a dotfile accepted where the rule says
  it is refused, a symlink accepted on a path checked by the no-symlink rule, a deny root
  that can be bypassed, or an uninspectable path that fails open.
- **Disclosure:** a refusal message that names a resolved address or repeats credentials,
  a query or a fragment where the README says it does not.
- **Parity:** a language that does not enforce what its own column of
  `policy/blocklist.v1.json` says, or that disagrees with its recorded verdict in `vectors/`.
- An exception of an undocumented type escaping a guard in a way that makes a typical caller
  fail open.

**Out of scope: the documented non-goals.** Each package README lists, under "Not covered",
what the library does not protect against. Those are known limits, not vulnerabilities:

- Python: [`python/README.md`, "Not covered: the caller must handle these"](python/README.md#not-covered-the-caller-must-handle-these)
- TypeScript: [`ts/README.md`, "Not covered"](ts/README.md#not-covered)
- The differences between the two languages recorded in
  [`vectors/DIFFERENCES.md`](vectors/DIFFERENCES.md) and
  [`vectors/REDIRECT-DIFFERENCES.md`](vectors/REDIRECT-DIFFERENCES.md), summarised in
  [`docs/parity.md`](docs/parity.md). They are policy decisions in progress.

In particular: this is a set of guards, not an operating-system sandbox (no process,
namespace or syscall isolation); DNS rebinding through the unpinned helpers; filesystem
races after the check (time of check to time of use); hard links; case-insensitive volumes;
Windows; and a public address that forwards traffic onward (an open proxy, a load balancer
that routes on `Host`).

If you are unsure whether something is in scope, report it privately anyway. If you think a
documented non-goal or a recorded `allow` is unsafe as a default, a public issue proposing a
policy change is welcome, unless it comes with a working exploit against a real deployment
pattern: then report it privately first.

## For maintainers

Keep the "Not covered" headings in both READMEs stable: the links above depend on their
anchors.
