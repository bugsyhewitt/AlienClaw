"""Localhost HTTP stub server for hermetic diagnostic audits.

Network-accessing runners (http_get, url_fetch, web_search) require a
live HTTP server. This stub binds to a random port on 127.0.0.1 and
serves canned responses keyed by URL path. No external network calls.

Usage:
    responses = {
        "/": (200, b'{"ok": true}', "application/json"),
        "/data": (200, b"hello", "text/plain"),
    }
    with StubServer(responses) as base_url:
        # base_url is e.g. "http://127.0.0.1:54321"
        result = http_get_runner.run({"url": base_url + "/"})
"""
from __future__ import annotations

import http.server
import socketserver
import threading
from contextlib import contextmanager
from typing import Generator


class _StubHandler(http.server.BaseHTTPRequestHandler):
    responses: dict[str, tuple[int, bytes, str]] = {}

    def do_GET(self) -> None:
        path = self.path.split("?")[0]  # strip query string
        if path in self.responses:
            status, body, content_type = self.responses[path]
        else:
            status, body, content_type = 404, b"not found", "text/plain"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        self.do_GET()

    def log_message(self, format: str, *args: object) -> None:
        pass  # silence access log during audits


@contextmanager
def StubServer(
    responses: dict[str, tuple[int, bytes, str]],
) -> Generator[str, None, None]:
    """Yield a base URL (e.g. 'http://127.0.0.1:PORT') for the block's duration."""
    _StubHandler.responses = dict(responses)
    server = socketserver.TCPServer(("127.0.0.1", 0), _StubHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        server.server_close()
