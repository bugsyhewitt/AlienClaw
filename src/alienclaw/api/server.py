"""HTTP server for api.alienclaw.net/v1/.

Uses stdlib http.server.BaseHTTPRequestHandler — no framework dependency.
Routes /v1/* paths, validates auth, rate-limits, dispatches to handlers.
"""
from __future__ import annotations

import dataclasses
import json
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from alienclaw.brains.registry import BrainRegistry

from .auth import hash_api_key, is_valid_api_key_format
from .handlers.genomes import handle_submit_genome, handle_top_genomes
from .handlers.health import handle_health
from .handlers.install import handle_install
from .handlers.martian_types import handle_martian_types
from .handlers.stats import handle_stats
from .audit_log import AuditLog
from .rate_limit import RateLimiter
from .storage import GlobalStats, InstallStore, SubmissionStore
from .types import APIError, InstallRequest, SubmissionRequest

_RATE_LIMITER: RateLimiter = RateLimiter()
_AUDIT_LOG: AuditLog = AuditLog()
_START_UP_REGISTRY: BrainRegistry | None = None
_REGISTERED_TYPES: set[str] = set()
_SUBMISSION_STORE: SubmissionStore | None = None
_INSTALL_STORE: InstallStore | None = None
_GLOBAL_STATS: GlobalStats | None = None


def configure(data_root: Path | None = None, msb_dir: str = "seed/msb/") -> None:
    """Initialize global server state (call once before serving)."""
    global _START_UP_REGISTRY, _REGISTERED_TYPES
    global _SUBMISSION_STORE, _INSTALL_STORE, _GLOBAL_STATS, _RATE_LIMITER, _AUDIT_LOG
    if data_root:
        os.environ["ALIENCLAW_API_DATA_ROOT"] = str(data_root)
    resolved_root = Path(data_root) if data_root else None
    _RATE_LIMITER = RateLimiter(data_root=resolved_root)
    _AUDIT_LOG = AuditLog(data_root=resolved_root)
    _START_UP_REGISTRY = BrainRegistry.load(msb_dir)
    _REGISTERED_TYPES = {b.tool for b in _START_UP_REGISTRY.all_brains()}
    _SUBMISSION_STORE = SubmissionStore()
    _INSTALL_STORE = InstallStore()
    _GLOBAL_STATS = GlobalStats()


def _json_serial(obj: Any) -> str:
    if dataclasses.is_dataclass(obj):
        return json.dumps(dataclasses.asdict(obj))
    raise TypeError(f"Not serializable: {type(obj)}")


class APIHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        pass  # suppress default access log; caller can add their own

    def _send(self, status: int, body: dict | Any, headers: dict | None = None) -> None:
        if dataclasses.is_dataclass(body):
            body = dataclasses.asdict(body)
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        # CORS for safe GET endpoints
        path = self.path.split("?")[0]
        if path in ("/v1/health", "/v1/stats", "/v1/martian-types") or path.startswith("/v1/genomes/top"):
            self.send_header("Access-Control-Allow-Origin", "*")
        if headers:
            for k, v in headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status: int, code: str, message: str, details: dict | None = None,
                extra_headers: dict | None = None) -> None:
        self._send(status, {"error": {"code": code, "message": message, "details": details or {}}},
                   headers=extra_headers)

    def _read_json(self) -> dict | None:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return None

    def _auth(self) -> str | None:
        """Validate Bearer token. Returns api_key_hash or None (and sends 401/400)."""
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            self._error(401, "UNAUTHORIZED", "Missing or invalid Authorization header.")
            return None
        key = auth[len("Bearer "):].strip()
        if not is_valid_api_key_format(key):
            self._error(400, "INVALID_API_KEY_FORMAT",
                        "API key must be exactly 43 Base62 characters.")
            return None
        khash = hash_api_key(key)
        if not _INSTALL_STORE or not _INSTALL_STORE.exists(khash):
            self._error(401, "UNAUTHORIZED",
                        "API key not registered. Call POST /v1/install first.")
            return None
        return khash

    # ── GET ──────────────────────────────────────────────────────────────────

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/v1/health":
            status, resp = handle_health()
            self._send(status, resp)

        elif path == "/v1/stats":
            status, resp = handle_stats(_GLOBAL_STATS, _INSTALL_STORE)
            self._send(status, resp)

        elif path == "/v1/martian-types":
            status, resp = handle_martian_types(_REGISTERED_TYPES, _SUBMISSION_STORE)
            self._send(status, resp)

        elif path == "/v1/genomes/top":
            martian_type = qs.get("martian_type", [""])[0]
            if not martian_type:
                self._error(400, "MISSING_PARAMETER", "martian_type query parameter is required.")
                return
            try:
                n = int(qs.get("n", ["10"])[0])
            except ValueError:
                n = 10
            if not (1 <= n <= 100):
                self._error(400, "INVALID_PARAMETER", "n must be between 1 and 100.")
                return
            try:
                status, resp = handle_top_genomes(martian_type, n, _SUBMISSION_STORE, _REGISTERED_TYPES)
                self._send(status, resp)
            except LookupError as exc:
                self._error(400, "UNKNOWN_MARTIAN_TYPE", str(exc).split(":")[-1].strip(),
                            {"available": sorted(_REGISTERED_TYPES)})

        else:
            self._error(404, "NOT_FOUND", f"No route for {path}")

    # ── POST ─────────────────────────────────────────────────────────────────

    def do_POST(self) -> None:
        path = self.path.rstrip("/")

        if path == "/v1/install":
            body = self._read_json()
            if body is None:
                self._error(400, "MALFORMED_REQUEST", "Request body must be valid JSON.")
                return
            missing = [f for f in ("api_key", "machine_hash") if f not in body]
            if missing:
                self._error(400, "MISSING_FIELDS", f"Missing required fields: {missing}",
                            {"missing": missing})
                return
            try:
                req = InstallRequest(api_key=body["api_key"], machine_hash=body["machine_hash"])
                status, resp = handle_install(req, _INSTALL_STORE)
                self._send(status, resp)
            except ValueError as exc:
                err: APIError = exc.args[0]
                self._send(400, {"error": dataclasses.asdict(err)})

        elif path == "/v1/genomes":
            khash = self._auth()
            if not khash:
                return
            # Rate limit
            allowed, retry_after = _RATE_LIMITER.check(khash)
            if not allowed:
                self._error(429, "RATE_LIMIT_EXCEEDED",
                            "Submission rate limit reached. Retry after the window resets.",
                            {"limit": 100, "window_seconds": 3600, "retry_after_seconds": retry_after},
                            extra_headers={"Retry-After": str(retry_after)})
                return
            body = self._read_json()
            if body is None:
                self._error(400, "MALFORMED_REQUEST", "Request body must be valid JSON.")
                return
            missing = [f for f in ("genome", "martian_type", "fitness") if f not in body]
            if missing:
                self._error(400, "MISSING_FIELDS", f"Missing required fields: {missing}",
                            {"missing": missing})
                return
            try:
                req = SubmissionRequest(
                    genome=body["genome"],
                    martian_type=body["martian_type"],
                    fitness=float(body["fitness"]),
                    run_metadata=body.get("run_metadata", {}),
                )
                client_ip = self.client_address[0] if self.client_address else "unknown"
                status, resp = handle_submit_genome(
                    req, khash, _SUBMISSION_STORE, _REGISTERED_TYPES,
                    audit_log=_AUDIT_LOG, client_ip=client_ip,
                )
                self._send(status, resp)
            except (ValueError, TypeError) as exc:
                if exc.args and isinstance(exc.args[0], APIError):
                    err = exc.args[0]
                    self._send(422, {"error": dataclasses.asdict(err)})
                else:
                    self._error(400, "MALFORMED_REQUEST", str(exc))

        else:
            self._error(404, "NOT_FOUND", f"No route for {path}")


def create_server(host: str = "0.0.0.0", port: int = 8080) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), APIHandler)
