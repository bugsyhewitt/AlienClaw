# Packet 8.6 — MSB File Changes

This is the first packet to edit the 8 MSB files. Only PARAMETER_SCHEMA sections were added. No other content was modified.

## Change per file

All 8 files received an identical structure change: a new `PARAMETER_SCHEMA:` section appended at the end, with 3 pipe-separated parameter field definitions.

### Format

```
PARAMETER_SCHEMA:
name|section|byte_offset|encoding|type|default
```

### Encodings used

| Encoding | Formula | Output range |
| --- | --- | --- |
| `mod5_plus1` | `((ord(char) - 48) % 5) + 1` | int [1..5] |
| `mod10_plus1` | `((ord(char) - 48) % 10) + 1` | int [1..10] |
| `mod10_times500` | `((ord(char) - 48) % 10) * 500` | int [0..4500] |
| `char_eq_F` | `char == 'F'` | bool |
| `char_code_even` | `ord(char) % 2 == 0` | bool |

The `-48` shift makes the '0' character (ASCII 48) encode to 0, consistent with the prose documentation ("charCode-48 mod 5 + 1 = maxAttempts").

### Parameters per file

| File | Shared params | Runner-specific param | Why |
| --- | --- | --- | --- |
| compute.msb | max_attempts, fail_forward | precision_digits (BEHAVIOR[1], mod5_plus1, int, 6) | Float output precision 1-5 → visibly changes output for non-integer expressions |
| extract_json.msb | max_attempts, fail_forward | include_type (BEHAVIOR[1], char_code_even, bool, true) | Whether to include "type" key in output → different output structure |
| file_read.msb | max_attempts, fail_forward | max_lines (BEHAVIOR[1], mod10_plus1, int, 100) | Truncate file content to 1-10 lines → different output length |
| file_write.msb | max_attempts, fail_forward | create_parents (BEHAVIOR[1], char_code_even, bool, true) | Whether to mkdir -p → different error behavior on missing parent |
| http_get.msb | max_attempts, fail_forward | include_headers (BEHAVIOR[1], char_code_even, bool, false) | Whether response headers appear in output → different output keys |
| search_text.msb | max_attempts, fail_forward | max_results (BEHAVIOR[1], mod10_plus1, int, 100) | Truncate match list to 1-10 → different match_count in output |
| url_fetch.msb | max_attempts, fail_forward | include_headers (BEHAVIOR[1], char_code_even, bool, false) | Same as http_get — consistent design |
| web_search.msb | max_attempts, fail_forward | max_results (BEHAVIOR[1], mod10_plus1, int, 5) | Limit result count → different output size |

### Why BEHAVIOR byte 1 for runner-specific params

BEHAVIOR byte 0 was already declared as escalation mode (fail_forward) in the prose. Byte 1 through 63 were "zero padding" — unused bandwidth. Byte 1 is the natural slot for the first runner-specific behavioral parameter. Future parameters can use bytes 2-63 without overlap.

### Backwards compatibility

- `PARAMETER_SCHEMA` is a new optional section. The existing parser returns `parameter_schema = ()` for MSB files without it. All existing brains-fixture tests continue to pass.
- The schema is supplementary to the existing prose GENOME SECTIONS documentation. Both coexist. The prose remains for human readability; the schema is the machine-readable companion.
