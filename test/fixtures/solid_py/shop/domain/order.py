"""Order aggregate.

VIOLATION (dependency rule): the domain imports from shop.infrastructure.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

from shop.domain.money import Money
from shop.infrastructure.db import Session


class OrderStatus(Enum):
    NEW = "new"
    PAID = "paid"
    SHIPPED = "shipped"


@dataclass
class OrderLine:
    sku: str
    quantity: int
    price: Money


@dataclass
class Order:
    id: str
    lines: List[OrderLine] = field(default_factory=list)
    status: OrderStatus = OrderStatus.NEW
    note: Optional[str] = None

    def total(self) -> Money:
        acc = Money(0)
        for line in self.lines:
            acc = acc.add(line.price)
        return acc

    def mark_paid(self) -> None:
        self.status = OrderStatus.PAID

    def save(self, session: Session) -> None:
        # Entity persisting itself through infrastructure.
        session.add("orders", {"id": self.id, "status": self.status.value})

    def describe(self) -> str:
        match self.status:
            case OrderStatus.NEW:
                return "new order"
            case _:
                return "processed order"
