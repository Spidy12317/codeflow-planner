"""Clean adapter for the PaymentGateway port."""
import uuid

from shop.domain.money import Money
from shop.domain.ports import PaymentGateway


class StripeGateway(PaymentGateway):
    def __init__(self, api_key: str):
        self._api_key = api_key

    def charge(self, amount: Money, token: str) -> str:
        return f"ch_{uuid.uuid4().hex[:8]}" if self._api_key and token else ""
