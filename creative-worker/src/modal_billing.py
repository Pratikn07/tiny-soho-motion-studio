"""Read the official Modal billing summary. No functions, containers or generation are invoked."""
from dataclasses import asdict
from decimal import Decimal, InvalidOperation
import math
import re
import sys
import json


def decimal(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise ValueError('Invalid billing amount') from error
    if not result.is_finite():
        raise ValueError('Invalid billing amount')
    return result


def normalize_summary(summary):
    if not isinstance(summary, dict) or not isinstance(summary.get('adjustments'), dict):
        raise ValueError('Incomplete billing summary')
    metered = decimal(summary.get('metered_cost'))
    billed = decimal(summary.get('billed_cost'))
    adjustments = {key: decimal(value) for key, value in summary['adjustments'].items()}
    # SDK summaries use display labels; the CLI JSON uses snake_case names.
    credits = adjustments.get('Credits', adjustments.get('credits', Decimal(0)))
    if metered < 0 or billed < 0 or credits > 0:
        raise ValueError('Unsupported billing adjustment')
    # Other adjustments (e.g. free storage) already affect billed cost. Adding back
    # only credits matches Modal's dashboard usage, rather than raw metered cost.
    result = {'usageUsd': float(billed - credits), 'creditsAppliedUsd': float(-credits), 'billedUsd': float(billed)}
    if not all(math.isfinite(value) for value in result.values()):
        raise ValueError('Invalid billing amount')
    return result


def main():
    month = sys.argv[1]
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise ValueError('Invalid billing cycle')
    import modal
    summary = modal.Workspace.from_context().billing.summary(month)
    print(json.dumps(normalize_summary(asdict(summary)), allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # SDK/transport errors must never leak credentials or provider internals.
        print('Modal billing unavailable', file=sys.stderr)
        sys.exit(1)
