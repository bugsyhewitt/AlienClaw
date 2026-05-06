"""CLI: python3 -m alienclaw.api serve --port 8080"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(prog="python3 -m alienclaw.api")
    sub = parser.add_subparsers(dest="cmd", required=True)

    serve = sub.add_parser("serve", help="Start the API server")
    serve.add_argument("--port", type=int, default=8080)
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--data-root", type=Path, default=None,
                       help="Override data storage root (default: /var/alienclaw)")
    serve.add_argument("--msb-dir", default="seed/msb/",
                       help="Path to the MSB brain files")

    args = parser.parse_args()

    if args.cmd == "serve":
        from .server import configure, create_server
        configure(data_root=args.data_root, msb_dir=args.msb_dir)
        srv = create_server(host=args.host, port=args.port)
        print(f"api.alienclaw.net server listening on {args.host}:{args.port}",
              file=sys.stderr)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.", file=sys.stderr)
            srv.shutdown()

    return 0


if __name__ == "__main__":
    sys.exit(main())
