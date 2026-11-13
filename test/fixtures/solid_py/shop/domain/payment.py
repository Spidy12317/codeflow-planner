"""Payment hierarchy."""
from abc import ABC, abstractmethod

from shop.domain.money import Money


class Payment(ABC):
    """Abstract base with some concrete behaviour."""

    def __init__(self, amount: Money):
        self.amount = amount

    @abstractmethod
    def capture(self) -> bool:
        ...

    def refund(self) -> Money:
        return self.amount


class CardPayment(Payment):
    def __init__(self, amount: Money, card_token: str):
        super().__init__(amount)
        self.card_token = card_token

    def capture(self) -> bool:
        return bool(self.card_token)


class CashPayment(Payment):
    def capture(self) -> bool:
        return True


class CryptoPayment(Payment):
    def __init__(self, amount: Money, wallet: str):
        super().__init__(amount)
        self.__wallet = wallet

    def capture(self) -> bool:
        return self.__wallet.startswith("0x")


class GiftCardPayment(Payment):
    """VIOLATION (LSP): refuses an operation the base class supports."""

    def capture(self) -> bool:
        return True

    def refund(self) -> Money:
        raise NotImplementedError("gift cards cannot be refunded")
