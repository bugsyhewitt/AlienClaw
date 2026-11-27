"""Known gaps, pinned as strict xfails so a fix shows up as XPASS (and fails the run).

Each test asserts the behavior a consumer would want and currently fails for the
reason given. See README.md, "Known gaps". (Three former entries are fixed in the
staged copy and now live as regression tests: DNS rebinding in test_dns_pinning.py,
search_text off the main thread in test_search_text_threads.py, and bad input types
for http_get, url_fetch and search_text in test_input_validation.py.)
"""
from __future__ import annotations

import pytest

from pho3nix_recon_http import web_search
from pho3nix_recon_http.types import RunResult
from pho3nix_recon_http.web_search import SEARCH_URL_ENV


@pytest.mark.xfail(
    strict=True,
    raises=ValueError,
    reason="web_search is kept identical to the reference: int() on a non-numeric param "
    "or num_results raises out of run()",
)
@pytest.mark.parametrize(("inputs", "params"), [
    ({"query": "q"}, {"max_results": "x"}),
    ({"query": "q", "num_results": "x"}, {}),
], ids=["param", "num_results"])
def test_web_search_bad_number_returns_an_error(inputs, params, monkeypatch) -> None:
    monkeypatch.setenv(SEARCH_URL_ENV, "http://stub.test/search")
    r = web_search.run(inputs, params)
    assert isinstance(r, RunResult) and r.ok is False
