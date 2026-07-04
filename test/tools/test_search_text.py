"""Direct unit tests for src/alienclaw/tools/search_text.py.

Authored: packet 115 — search_text MSB-spec field alignment + 10 MB guard.
Coverage: 18 cases in 6 classes covering MSB output contract + error paths.
"""

import pytest

from alienclaw.tools.search_text import run


# ---------------------------------------------------------------------------
# Class 1 — Input validation
# ---------------------------------------------------------------------------


class TestInputValidation:
    def test_missing_text_returns_error(self):
        r = run({"text": "", "pattern": "foo"})
        assert r.ok is False
        assert r.error is not None and "text" in r.error

    def test_missing_pattern_returns_error(self):
        r = run({"text": "hello", "pattern": ""})
        assert r.ok is False
        assert r.error is not None and "pattern" in r.error

    def test_content_alias_for_text(self):
        r = run({"content": "foo bar", "pattern": "foo"})
        assert r.ok is True
        assert r.output["totalMatches"] == 1

    def test_query_alias_for_pattern(self):
        r = run({"text": "foo bar", "query": "foo"})
        assert r.ok is True
        assert r.output["totalMatches"] == 1


# ---------------------------------------------------------------------------
# Class 2 — MSB-spec field names
# ---------------------------------------------------------------------------


class TestMsbOutputContract:
    def test_top_level_keys_present(self):
        r = run({"text": "foo bar\nfoo baz", "pattern": "foo"})
        assert r.ok is True
        # MSB output contract top-level keys
        assert "pattern" in r.output
        assert "flavor" in r.output
        assert "caseSensitive" in r.output
        assert "totalMatches" in r.output
        assert "truncated" in r.output
        assert "matches" in r.output

    def test_legacy_keys_absent(self):
        r = run({"text": "foo bar\nfoo baz", "pattern": "foo"})
        # Old names MUST NOT appear
        assert "match_count" not in r.output

    def test_match_entry_msb_keys(self):
        r = run({"text": "foo bar\nfoo baz", "pattern": "foo"})
        match = r.output["matches"][0]
        assert "matchText" in match
        assert "lineNumber" in match
        assert "startOffset" in match
        assert "endOffset" in match

    def test_match_entry_legacy_keys_absent(self):
        r = run({"text": "foo bar\nfoo baz", "pattern": "foo"})
        match = r.output["matches"][0]
        assert "line" not in match
        assert "text" not in match
        assert "match" not in match

    def test_match_text_is_substring_only(self):
        # MSB: matchText is the matched substring, not the whole line.
        r = run({"text": "prefix foo suffix", "pattern": "foo"})
        assert r.output["matches"][0]["matchText"] == "foo"

    def test_line_number_is_one_indexed(self):
        r = run({"text": "line 1\nline 2\nfoo here", "pattern": "foo"})
        assert r.output["matches"][0]["lineNumber"] == 3

    def test_offsets_are_line_relative(self):
        # MSB: startOffset/endOffset are m.start()/m.end() — LINE-relative
        r = run({"text": "pre foo suffix", "pattern": "foo"})
        match = r.output["matches"][0]
        # "pre " = 4 chars, "foo" starts at 4 ends at 7 — LINE-relative, NOT doc-relative
        assert match["startOffset"] == 4
        assert match["endOffset"] == 7


# ---------------------------------------------------------------------------
# Class 3 — Match logic
# ---------------------------------------------------------------------------


class TestMatchLogic:
    def test_literal_default_case_insensitive(self):
        r = run({"text": "Hello World", "pattern": "hello"})
        assert r.ok is True
        assert r.output["totalMatches"] == 1
        assert r.output["caseSensitive"] is False

    def test_literal_case_sensitive(self):
        r = run({"text": "Hello World", "pattern": "hello", "case_sensitive": True})
        assert r.output["totalMatches"] == 0
        assert r.output["caseSensitive"] is True

    def test_regex_pattern(self):
        r = run({"text": "foo123\nbar456", "pattern": r"\d+", "regex": True})
        assert r.output["totalMatches"] == 2

    def test_regex_invalid_returns_error(self):
        r = run({"text": "foo", "pattern": r"[unclosed", "regex": True})
        assert r.ok is False
        assert r.error is not None and "Regex error" in r.error

    def test_zero_matches_returns_ok(self):
        r = run({"text": "abc def", "pattern": "xyz"})
        assert r.ok is True
        assert r.output["totalMatches"] == 0
        assert r.output["matches"] == []

    def test_glob_wildcard_star(self):
        # flavor="glob": * expands to .* — matches any suffix; anchored full-line
        r = run({"text": "hello world\nfoo bar\nhello again", "pattern": "hel*", "flavor": "glob"})
        assert r.ok is True
        assert r.output["flavor"] == "glob"
        assert r.output["totalMatches"] == 2  # "hello world" and "hello again"

    def test_glob_wildcard_question_mark(self):
        # flavor="glob": ? matches exactly one character; ^ca.$ excludes "camel"
        r = run({"text": "cat\ncar\ncab\ncamel", "pattern": "ca?", "flavor": "glob"})
        assert r.ok is True
        assert r.output["totalMatches"] == 3  # cat, car, cab — NOT camel

    def test_unknown_flavor_falls_back_to_literal(self):
        # Unrecognized flavor silently resets to "literal" (line 28 behavioral invariant)
        r = run({"text": "hello world", "pattern": "hello", "flavor": "badvalue"})
        assert r.ok is True
        assert r.output["totalMatches"] == 1
        assert r.output["flavor"] == "literal"


# ---------------------------------------------------------------------------
# Class 4 — Truncation flag
# ---------------------------------------------------------------------------


class TestTruncation:
    def test_truncated_false_when_under_limit(self):
        text = "\n".join([f"foo line {i}" for i in range(5)])
        r = run({"text": text, "pattern": "foo"})
        assert r.output["truncated"] is False

    def test_truncated_true_when_capped(self):
        text = "\n".join([f"foo line {i}" for i in range(20)])
        r = run({"text": text, "pattern": "foo"}, {"max_results": 5})
        assert r.output["totalMatches"] == 5
        assert r.output["truncated"] is True


# ---------------------------------------------------------------------------
# Class 5 — 10 MB guard (FAILURE MODE)
# ---------------------------------------------------------------------------


class TestBodySizeLimit:
    def test_under_10mb_passes(self):
        text = "x" * (5 * 1024 * 1024)  # 5 MB
        r = run({"text": text, "pattern": "x"})
        assert r.ok is True

    def test_over_10mb_returns_failure(self):
        # MSB FAILURE MODES: "Text body exceeds 10 MB: return FAILURE — do not silently truncate."
        text = "x" * (11 * 1024 * 1024)  # 11 MB
        r = run({"text": text, "pattern": "x"})
        assert r.ok is False
        assert r.error is not None and "10 MB" in r.error


# ---------------------------------------------------------------------------
# Class 6 — Context lines
# ---------------------------------------------------------------------------


class TestContextLines:
    def test_context_lines_zero_omits_fields(self):
        # context_lines=1 maps to 0 surrounding lines (per existing param semantics).
        r = run({"text": "a\nfoo\nb", "pattern": "foo"}, {"context_lines": 1})
        match = r.output["matches"][0]
        assert "contextBefore" not in match
        assert "contextAfter" not in match

    def test_context_lines_two_includes_surrounding(self):
        r = run(
            {"text": "a\nb\nfoo\nc\nd", "pattern": "foo"},
            {"context_lines": 3},
        )
        match = r.output["matches"][0]
        assert match["contextBefore"] == ["a", "b"]
        assert match["contextAfter"] == ["c", "d"]