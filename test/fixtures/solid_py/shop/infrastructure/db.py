"""Persistence plumbing."""
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Session:
    """Tiny fake DB session."""

    def __init__(self, url: str = "sqlite://"):
        self.url = url
        self._rows: Dict[str, List[dict]] = {}

    def add(self, table: str, row: dict) -> None:
        self._rows.setdefault(table, []).append(row)

    def query(self, table: str) -> List[dict]:
        return list(self._rows.get(table, []))

    def commit(self) -> None:
        pass


class OrderRow(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True)
    status = Column(String)


def get_session(url: Optional[str] = None) -> Session:
    return Session(url or "sqlite://")
