import urllib.request
import pytest
from alienclaw.diagnostics.stub_servers import StubServer


class TestStubServer:
    def test_serves_configured_response(self):
        responses = {"/": (200, b"hello world", "text/plain")}
        with StubServer(responses) as base_url:
            with urllib.request.urlopen(base_url + "/") as resp:
                assert resp.status == 200
                assert resp.read() == b"hello world"

    def test_returns_404_for_unknown_path(self):
        with StubServer({}) as base_url:
            req = urllib.request.Request(base_url + "/missing")
            try:
                urllib.request.urlopen(req)
                assert False, "Should have raised"
            except urllib.error.HTTPError as exc:
                assert exc.code == 404

    def test_json_response(self):
        import json
        body = json.dumps({"result": 42}).encode()
        with StubServer({"/data": (200, body, "application/json")}) as base_url:
            with urllib.request.urlopen(base_url + "/data") as resp:
                data = json.loads(resp.read())
                assert data["result"] == 42

    def test_multiple_paths(self):
        responses = {
            "/a": (200, b"A", "text/plain"),
            "/b": (200, b"B", "text/plain"),
        }
        with StubServer(responses) as base_url:
            with urllib.request.urlopen(base_url + "/a") as r:
                assert r.read() == b"A"
            with urllib.request.urlopen(base_url + "/b") as r:
                assert r.read() == b"B"

    def test_server_stops_after_context(self):
        with StubServer({"/": (200, b"ok", "text/plain")}) as base_url:
            pass
        # After exit, server is stopped — connection should fail
        import socket
        url = base_url
        port = int(url.split(":")[-1])
        with pytest.raises(Exception):
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                pass

    def test_post_request_served_same_as_get(self):
        """L41: do_POST delegates to do_GET — POST requests return the configured stub response."""
        responses = {"/submit": (200, b"accepted", "text/plain")}
        with StubServer(responses) as base_url:
            req = urllib.request.Request(
                base_url + "/submit",
                data=b"some_payload",
                method="POST",
            )
            with urllib.request.urlopen(req) as resp:
                assert resp.status == 200
                assert resp.read() == b"accepted"
