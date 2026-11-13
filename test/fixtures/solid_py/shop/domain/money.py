"""Clean value object."""
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Money:
    amount: Decimal
    currency: str = "EUR"

    def add(self, other: "Money") -> "Money":
        return Money(self.amount + other.amount, self.currency)

    def is_zero(self) -> bool:
        return self.amount == 0
