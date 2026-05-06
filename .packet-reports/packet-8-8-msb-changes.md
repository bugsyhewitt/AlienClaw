# Packet 8.8 — MSB Changes

All changes are PARAMETER_SCHEMA additions only. No existing parameters modified.

## Changes per file

| File | Addition |
| --- | --- |
| file_read.msb | `chunk_count\|BEHAVIOR\|3\|mod5_plus1\|int\|1` |
| compute.msb | `validation_count\|BEHAVIOR\|3\|mod5_plus1\|int\|1` |
| extract_json.msb | `extraction_passes\|BEHAVIOR\|2\|mod5_plus1\|int\|1` |
| http_get.msb | `request_count\|BEHAVIOR\|3\|mod5_plus1\|int\|1` |
| url_fetch.msb | `request_count\|BEHAVIOR\|3\|mod5_plus1\|int\|1` |
| web_search.msb | `page_count\|BEHAVIOR\|2\|mod3_plus1\|int\|1` |
| file_write.msb | (no change — repeat_count already at BEHAVIOR\|1) |

## No new encodings

mod5_plus1 and mod3_plus1 already exist in decoder.py from Packets 8.6/8.7.
