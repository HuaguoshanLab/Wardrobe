"""Load the complete business schema in API, migration and controller processes alike."""

from importlib import import_module

from sqlalchemy import MetaData

from app.db.models import Base


def business_metadata() -> MetaData:
    for module in (
        "collections",
        "feedback",
        "inventory",
        "lifecycle",
        "organization",
        "outfits",
        "profile",
        "recognition",
        "seasonal",
        "wardrobe",
        "templates",
        "travel",
        "reference",
    ):
        import_module(f"app.db.{module}")
    return Base.metadata
