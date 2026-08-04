"""Price comparison logic: classify a new price against the last check, and
compute the rolling 14-day baseline used as email context.
"""
import statistics
from dataclasses import dataclass
from typing import Literal, Optional

PriceChange = Literal["unchanged", "decrease", "increase"]

BASELINE_DAYS = 14
BASELINE_MIN_SAMPLES = 3  # not enough history yet -> skip baseline, per architecture doc


@dataclass
class BaselineStats:
    mean: float
    stdev: float
    minimum: int
    sample_count: int


def classify(current_price: int, last_price: int) -> PriceChange:
    if current_price == last_price:
        return "unchanged"
    return "decrease" if current_price < last_price else "increase"


def percent_change(old_price: int, new_price: int) -> float:
    if old_price == 0:
        return 0.0
    return (new_price - old_price) / old_price * 100


def compute_baseline(history_prices: list[int]) -> Optional[BaselineStats]:
    if len(history_prices) < BASELINE_MIN_SAMPLES:
        return None
    return BaselineStats(
        mean=statistics.mean(history_prices),
        stdev=statistics.pstdev(history_prices),
        minimum=min(history_prices),
        sample_count=len(history_prices),
    )


def is_new_low(current_price: int, history_prices: list[int]) -> bool:
    if not history_prices:
        return True
    return current_price <= min(history_prices)
