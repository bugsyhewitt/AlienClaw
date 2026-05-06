"""CLI: python3 -m alienclaw.diagnostics audit [--seed N] [--output file.json]"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .sensitivity_audit import run_audit
from .reporting import format_report


def main() -> int:
    parser = argparse.ArgumentParser(prog="python3 -m alienclaw.diagnostics")
    sub = parser.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("audit")
    a.add_argument("--seed", type=int, default=42)
    a.add_argument("--output", type=Path, default=None, help="Write raw JSON results")
    a.add_argument("--report", type=Path, default=None, help="Write markdown report")
    args = parser.parse_args()

    if args.cmd == "audit":
        print(f"Running sensitivity audit (seed={args.seed})...", file=sys.stderr)
        results = run_audit(seed=args.seed)

        blind = sum(1 for s in results.sensitivities if s.classification == "BLIND")
        print(f"Done. {len(results.runners_audited)} runners, "
              f"{blind} BLIND / {len(results.runners_audited) - blind} with signal.",
              file=sys.stderr)

        raw = results.to_dict()
        if args.output:
            args.output.write_text(json.dumps(raw, indent=2))
            print(f"Raw data → {args.output}", file=sys.stderr)
        else:
            print(json.dumps(raw, indent=2))

        report = format_report(results)
        if args.report:
            args.report.write_text(report)
            print(f"Report → {args.report}", file=sys.stderr)
        else:
            print(report, file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
