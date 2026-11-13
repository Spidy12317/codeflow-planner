"""Ports (interfaces) owned by the domain."""
from abc import ABC, abstractmethod
from typing import List, Optional, Protocol

from shop.domain.money import Money
from shop.domain.order import Order


class OrderRepository(ABC):
    """Port: persistence of orders."""

    @abstractmethod
    def get(self, order_id: str) -> Optional[Order]:
        """Load one order."""

    @abstractmethod
    def add(self, order: Order) -> None:
        ...

    @abstractmethod
    def list_open(self) -> List[Order]:
        raise NotImplementedError


class PaymentGateway(Protocol):
    def charge(self, amount: Money, token: str) -> str:
        ...


class StoreAdmin(ABC):
    """VIOLATION (ISP): fat interface, 8 abstract methods."""

    @abstractmethod
    def create_product(self, sku: str) -> None: ...

    @abstractmethod
    def delete_product(self, sku: str) -> None: ...

    @abstractmethod
    def set_price(self, sku: str, price: Money) -> None: ...

    @abstractmethod
    def restock(self, sku: str, quantity: int) -> None: ...

    @abstractmethod
    def export_sales_report(self) -> str: ...

    @abstractmethod
    def send_newsletter(self, subject: str) -> None: ...

    @abstractmethod
    def rotate_api_keys(self) -> None: ...

    @abstractmethod
    def backup_database(self) -> None: ...
