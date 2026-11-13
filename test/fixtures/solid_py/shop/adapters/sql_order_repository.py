"""SQL adapter implementing the OrderRepository port."""
from typing import List, Optional

from shop.domain.order import Order
from shop.domain.ports import OrderRepository
from shop.infrastructure.db import Session


class SqlOrderRepository(OrderRepository):
    def __init__(self, url: str = "sqlite://"):
        self.session = Session(url)
        self._cache = {}

    def get(self, order_id: str) -> Optional[Order]:
        if order_id in self._cache:
            return self._cache[order_id]
        rows = [r for r in self.session.query("orders") if r["id"] == order_id]
        return Order(id=rows[0]["id"]) if rows else None

    def add(self, order: Order) -> None:
        self._cache[order.id] = order
        order.save(self.session)
        self.session.commit()

    def list_open(self) -> List[Order]:
        return [o for o in self._cache.values() if o.status.value == "new"]
