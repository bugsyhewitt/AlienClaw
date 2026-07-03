"""Shared tool I/O limits.

Single source of truth for the 10 MiB per-operation input cap that the
MSB LIMITATIONS sections promise ("File size limit: 10MB per read") and
that file_read, search_text, and extract_json enforce. The TS adapter
layer mirrors this as MAX_FILE_READ_BYTES in src/alienclaw/constants.ts —
keep the two in sync when changing either.
"""

MAX_TOOL_IO_BYTES = 10 * 1024 * 1024  # 10 MiB
