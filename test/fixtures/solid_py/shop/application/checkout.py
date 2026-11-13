"""Use cases."""
from shop.adapters.sql_order_repository import SqlOrderRepository
from shop.domain.money import Money
from shop.domain.order import Order
from shop.domain.payment import CardPayment, CashPayment, CryptoPayment, Payment
from shop.domain.ports import OrderRepository, PaymentGateway


class PlaceOrder:
    """VIOLATION (DIP): builds a concrete adapter instead of receiving the port."""

    def __init__(self):
        self.repo = SqlOrderRepository()

    def execute(self, order_id: str) -> Order:
        order = Order(id=order_id)
        self.repo.add(order)
        return order


class CheckoutService:
    """Clean: depends on ports injected through the constructor."""

    def __init__(self, orders: OrderRepository, gateway: PaymentGateway):
        self.orders = orders
        self.gateway = gateway

    def checkout(self, order_id: str, token: str) -> str:
        order = self.orders.get(order_id)
        if order is None:
            raise LookupError(order_id)
        receipt = self.gateway.charge(order.total(), token)
        order.mark_paid()
        self.orders.add(order)
        return receipt


class PaymentFeeCalculator:
    """VIOLATION (OCP): type switch over payment subclasses."""

    def fee(self, payment: Payment) -> Money:
        if isinstance(payment, CardPayment):
            return Money(payment.amount.amount * 3 / 100)
        elif isinstance(payment, (CashPayment, CryptoPayment)):
            return Money(0)
        elif type(payment) is Payment:
            return Money(1)
        return Money(0)
