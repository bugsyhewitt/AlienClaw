"""Campaign input generator for composition Martian audit and evolution.

Provides appropriate campaign-level inputs for each composition Martian's
slot 0 (which always has inputs_from=null and reads from campaign inputs).
The bridge handles slot-to-slot wiring from these campaign inputs.

Used by:
- alienclaw.diagnostics.sensitivity_audit.run_martian_audit (Packet 19)
- alienclaw.evolution composition experiments (Packet 19)

Design notes
------------
Each composition Martian's slot 0 reads from the bridge's `inputs` field
(campaign inputs). For Martians whose slot 1 ALSO reads from
`${campaign.X}` (compute_then_write, search_then_fetch, *_then_extract,
fetch_then_parse), we include those campaign-level fields too — otherwise
slot 1 would fail input resolution.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def get_composition_inputs(
    martian_type: str,
    stub_base_url: str,
    tmpdir: Path,
) -> dict[str, Any]:
    """Return appropriate campaign inputs for a composition Martian's slot 0.

    Args:
        martian_type: Name of the composition Martian.
        stub_base_url: Base URL of the running stub server (for HTTP tools).
        tmpdir: Temp directory for file-based tools.

    Returns:
        Dict of campaign inputs appropriate for this Martian. Returns {}
        for unknown Martian types.
    """
    # search_then_count: slot 0 = search_text, slot 1 = compute(${slot[0].output.totalMatches})
    # 20 lines containing "fox" so max_results param produces different
    # totalMatches values across genome pairs → composition sensitivity.
    if martian_type == "search_then_count":
        text = "\n".join(f"The fox was spotted on line {i}" for i in range(1, 21))
        return {"text": text, "pattern": "fox"}

    # compute_then_validate: slot 0 = compute, slot 1 = extract_json(${slot[0].output.result})
    # Use a float-division expression so slot 0's precision_digits param produces
    # variable result strings (e.g. "2.3", "2.333", "2.3333333333"). Bare-number
    # JSON parses fine in extract_json, and the parsed value differs across
    # genomes → composition output sensitivity.
    if martian_type == "compute_then_validate":
        return {"input": "7 / 3"}

    # fetch_then_parse: slot 0 = http_get, slot 1 = extract_json(json=body, path=${campaign.extract_path})
    if martian_type == "fetch_then_parse":
        return {
            "url": stub_base_url + "/json",
            "extract_path": "title",
        }

    # read_then_extract: slot 0 = file_read, slot 1 = extract_json(json=content, path=${campaign.extract_path})
    if martian_type == "read_then_extract":
        json_path = tmpdir / "test_read_extract.json"
        json_path.write_text(
            json.dumps({"title": "audit test", "value": 42, "items": [1, 2, 3]}),
            encoding="utf-8",
        )
        return {
            "path": str(json_path),
            "extract_path": "title",
        }

    # fetch_then_extract: slot 0 = url_fetch, slot 1 = extract_json(json=content, path=${campaign.extract_path})
    if martian_type == "fetch_then_extract":
        return {
            "url": stub_base_url + "/json",
            "method": "GET",
            "extract_path": "title",
        }

    # write_then_verify: slot 0 = file_write, slot 1 = file_read(path=${slot[0].output.path})
    if martian_type == "write_then_verify":
        write_path = tmpdir / "verify_test.txt"
        return {"path": str(write_path), "content": "audit write verify data"}

    # compute_then_write: slot 0 = compute, slot 1 = file_write(path=${campaign.write_path}, content=${slot[0].output.result})
    if martian_type == "compute_then_write":
        write_path = tmpdir / "compute_write_test.txt"
        return {"input": "7 / 3", "write_path": str(write_path)}

    # search_then_fetch: slot 0 = search_text, slot 1 = http_get(url=${campaign.fetch_url})
    if martian_type == "search_then_fetch":
        text = "\n".join(
            f"Visit https://example.com/page{i} for details" for i in range(1, 11)
        )
        return {
            "text": text,
            "pattern": "example",
            "fetch_url": stub_base_url + "/test",
        }

    return {}
