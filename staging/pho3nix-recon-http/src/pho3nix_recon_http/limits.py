"""Shared tool I/O limits.

Single source of truth for the 10 MiB per-operation input cap that search_text
enforces ("Text body exceeds 10 MB: return FAILURE, do not silently truncate").
The reference sources apply the same cap to their file and JSON tools and mirror it
in a TypeScript constant; keep them in sync when changing it.
"""

MAX_TOOL_IO_BYTES = 10 * 1024 * 1024  # 10 MiB
