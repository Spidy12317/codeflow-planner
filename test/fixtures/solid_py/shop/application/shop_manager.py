"""VIOLATION (SRP / low cohesion): one service doing everything."""
import smtplib
from typing import List

from shop.domain.money import Money
from shop.infrastructure.db import Session


class ShopManager:
    def __init__(self, session: Session, smtp_host: str):
        self.session = session
        self.smtp_host = smtp_host
        self.inventory = {}
        self.prices = {}
        self.subscribers: List[str] = []
        self.audit_log = []
        self.tax_rate = 0.2

    # inventory
    def add_stock(self, sku: str, qty: int) -> None:
        self.inventory[sku] = self.inventory.get(sku, 0) + qty

    def remove_stock(self, sku: str, qty: int) -> None:
        self.inventory[sku] = self.inventory.get(sku, 0) - qty

    def stock_level(self, sku: str) -> int:
        return self.inventory.get(sku, 0)

    # pricing
    def set_price(self, sku: str, price: Money) -> None:
        self.prices[sku] = price

    def price_with_tax(self, sku: str) -> float:
        return float(self.prices[sku].amount) * (1 + self.tax_rate)

    def set_tax_rate(self, rate: float) -> None:
        self.tax_rate = rate

    # marketing
    def subscribe(self, email: str) -> None:
        self.subscribers.append(email)

    def unsubscribe(self, email: str) -> None:
        self.subscribers.remove(email)

    def send_newsletter(self, body: str) -> None:
        server = smtplib.SMTP(self.smtp_host)
        for s in self.subscribers:
            server.sendmail("shop@example.com", s, body)

    # persistence / audit
    def save_all(self) -> None:
        self.session.add("inventory", dict(self.inventory))
        self.session.commit()

    def log(self, msg: str) -> None:
        self.audit_log.append(msg)

    def export_audit(self) -> str:
        return "\n".join(self.audit_log)
