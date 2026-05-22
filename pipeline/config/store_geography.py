"""Constant city/region mapping for LKUS stores.

t_shop_info has geographic columns (locality_name, administrative_area_name)
but all rows for LKUS have those columns NULL. We ship a pipeline-side constant
mapping based on the public street addresses until ops populates the columns.

Source confidence in the payload is set to 'pipeline-constant'.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StoreLocation:
    shop_number: str
    shop_name_en: str
    shop_name_zh: str | None
    city_id: str
    region_id: str


CITY_NEW_YORK = {"id": "NYC", "label_zh": "纽约", "label_en": "New York"}

REGIONS: list[dict] = [
    {
        "id": "NYC-MIDTOWN-EAST",
        "city_id": "NYC",
        "label_zh": "中城东 / 麦迪逊",
        "label_en": "Midtown East / Madison",
    },
    {
        "id": "NYC-MIDTOWN-WEST",
        "city_id": "NYC",
        "label_zh": "中城西",
        "label_en": "Midtown West",
    },
    {
        "id": "NYC-FLATIRON-GRAMERCY",
        "city_id": "NYC",
        "label_zh": "熨斗区 / 格拉梅西",
        "label_en": "Flatiron / Gramercy",
    },
    {
        "id": "NYC-LOWER-MANHATTAN",
        "city_id": "NYC",
        "label_zh": "下曼哈顿",
        "label_en": "Lower Manhattan",
    },
]

STORES: list[StoreLocation] = [
    StoreLocation("US00001", "8th & Broadway",   "百老汇 & 8 大道",     "NYC", "NYC-MIDTOWN-WEST"),
    StoreLocation("US00002", "28th & 6th",        "28 街 & 6 大道",      "NYC", "NYC-FLATIRON-GRAMERCY"),
    StoreLocation("US00003", "100 Maiden Ln",     "梅登巷 100 号",        "NYC", "NYC-LOWER-MANHATTAN"),
    StoreLocation("US00004", "37th & Broadway",   "37 街 & 百老汇",       "NYC", "NYC-MIDTOWN-WEST"),
    StoreLocation("US00005", "54th & 8th",        "54 街 & 8 大道",       "NYC", "NYC-MIDTOWN-WEST"),
    StoreLocation("US00006", "102 Fulton",        "富尔顿街 102 号",      "NYC", "NYC-LOWER-MANHATTAN"),
    StoreLocation("US00008", "33rd & 10th",       "33 街 & 10 大道",      "NYC", "NYC-MIDTOWN-WEST"),
    StoreLocation("US00012", "16th & 6th",        "16 街 & 6 大道",       "NYC", "NYC-FLATIRON-GRAMERCY"),
    StoreLocation("US00020", "21st & 3rd",        "21 街 & 3 大道",       "NYC", "NYC-FLATIRON-GRAMERCY"),
    StoreLocation("US00024", "15th & 3rd",        "15 街 & 3 大道",       "NYC", "NYC-FLATIRON-GRAMERCY"),
    StoreLocation("US00025", "221 Grand",         "大街 221 号",          "NYC", "NYC-LOWER-MANHATTAN"),
    StoreLocation("US00027", "52nd & Madison",    "52 街 & 麦迪逊",       "NYC", "NYC-MIDTOWN-EAST"),
]


def cities() -> list[dict]:
    return [CITY_NEW_YORK]


def regions_by_city(city_id: str) -> list[dict]:
    return [r for r in REGIONS if r["city_id"] == city_id]


def stores_for_region(region_id: str) -> list[StoreLocation]:
    return [s for s in STORES if s.region_id == region_id]


def build_hierarchy() -> dict:
    out_cities = []
    for c in cities():
        regions_payload = []
        for r in regions_by_city(c["id"]):
            regions_payload.append(
                {
                    "id": r["id"],
                    "cityId": c["id"],
                    "labelZh": r["label_zh"],
                    "labelEn": r["label_en"],
                    "storeNumbers": [s.shop_number for s in stores_for_region(r["id"])],
                }
            )
        out_cities.append(
            {
                "id": c["id"],
                "labelZh": c["label_zh"],
                "labelEn": c["label_en"],
                "regions": regions_payload,
            }
        )
    out_stores = [
        {
            "shopNumber": s.shop_number,
            "shopNameEn": s.shop_name_en,
            "shopNameZh": s.shop_name_zh,
            "cityId": s.city_id,
            "regionId": s.region_id,
            "status": "active",
        }
        for s in STORES
    ]
    return {"cities": out_cities, "stores": out_stores, "source": "pipeline-constant"}
