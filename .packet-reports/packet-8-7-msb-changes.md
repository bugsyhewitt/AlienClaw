# Packet 8.7 — MSB Changes

All changes are PARAMETER_SCHEMA modifications only. No prose content was altered.

## Changes per file

| File | Before | After |
| --- | --- | --- |
| extract_json.msb | `include_type\|BEHAVIOR\|1\|char_code_even\|bool\|true` | `result_format\|BEHAVIOR\|1\|mod3_plus1\|int\|2` |
| file_write.msb | `create_parents\|BEHAVIOR\|1\|char_code_even\|bool\|true` | `repeat_count\|BEHAVIOR\|1\|mod5_plus1\|int\|1` |
| http_get.msb | `include_headers\|BEHAVIOR\|1\|char_code_even\|bool\|false` | `field_count\|BEHAVIOR\|1\|mod5_plus1\|int\|3` + new `body_preview\|BEHAVIOR\|2\|mod10_plus1\|int\|5` |
| url_fetch.msb | `include_headers\|BEHAVIOR\|1\|char_code_even\|bool\|false` | `field_count\|BEHAVIOR\|1\|mod5_plus1\|int\|3` |
| compute.msb | `output_format\|BEHAVIOR\|2\|mod3_plus1\|int\|2` | `output_format\|BEHAVIOR\|2\|mod10_plus1\|int\|2` (encoding changed) |
| search_text.msb | `context_lines\|BEHAVIOR\|2\|mod3_plus1\|int\|0` | `context_lines\|BEHAVIOR\|2\|mod10_plus1\|int\|1` (encoding changed) |
| url_fetch.msb | (addition) `content_preview\|BEHAVIOR\|2\|mod10_plus1\|int\|2` | (unchanged encoding, value range now makes sense with 12-line stub body) |
| file_read.msb | (no second param) | `skip_lines\|BEHAVIOR\|2\|mod10_plus1\|int\|1` |

## New encoding added to decoder

`mod3_plus1` was added to `_apply_encoding()` in `src/alienclaw/brains/decoder.py`:
`(rel % 3) + 1` → int [1..3].
