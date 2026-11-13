"""VIOLATION (ISP): implementer forced to stub most of a fat interface."""
from shop.domain.money import Money
from shop.domain.ports import StoreAdmin


class BasicStoreAdmin(StoreAdmin):
    def __init__(self):
        self.products = {}

    def create_product(self, sku: str) -> None:
        self.products[sku] = None

    def delete_product(self, sku: str) -> None:
        pass

    def set_price(self, sku: str, price: Money) -> None:
        self.products[sku] = price

    def restock(self, sku: str, quantity: int) -> None:
        pass

    def export_sales_report(self) -> str:
        raise NotImplementedError

    def send_newsletter(self, subject: str) -> None:
        pass

    def rotate_api_keys(self) -> None:
        ...

    def backup_database(self) -> None:
        pass
