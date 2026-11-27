"""search_text's pattern compile and line scan, runnable in-process or as a child script.

Standard library only and no package imports, because search_text also runs this file
as ``python -I -S _scan.py`` when it cannot use SIGALRM (see search_text.py). The
child protocol, on stdin: one JSON line ``{"pattern", "flavor", "flags"}``, then the
text as UTF-8 (lone surrogates passed through). On stdout: ``{"hits": [[i, start,
end], ...]}`` or ``{"regex_error": "<str(re.error)>"}``.
"""
import json
import re
import sys


def compile_pattern(pattern: str, flavor: str, flags: int) -> "re.Pattern[str]":
    if flavor == "literal":
        return re.compile(re.escape(pattern), flags)
    if flavor == "glob":
        # Convert glob to regex: *→.* ?→. .*? → literal.
        glob_re = "^" + re.escape(pattern).replace(r"\*", ".*").replace(r"\?", ".") + "$"
        return re.compile(glob_re, flags)
    return re.compile(pattern, flags)  # regex


def scan(compiled: "re.Pattern[str]", lines: list[str]) -> list[tuple[int, int, int]]:
    """(line index, start, end) of the first match on each line that has one."""
    hits = []
    for i, line in enumerate(lines):
        m = compiled.search(line)
        if m:
            hits.append((i, m.start(), m.end()))
    return hits


def _main() -> None:
    header, _, body = sys.stdin.buffer.read().partition(b"\n")
    job = json.loads(header)
    try:
        compiled = compile_pattern(job["pattern"], job["flavor"], job["flags"])
    except re.error as exc:
        out: dict = {"regex_error": str(exc)}
    else:
        out = {"hits": scan(compiled, body.decode("utf-8", "surrogatepass").splitlines())}
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    _main()
