from datetime import date, datetime
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.common import Schema

MAINLAND_PROVINCES = (
    "北京市",
    "天津市",
    "河北省",
    "山西省",
    "内蒙古自治区",
    "辽宁省",
    "吉林省",
    "黑龙江省",
    "上海市",
    "江苏省",
    "浙江省",
    "安徽省",
    "福建省",
    "江西省",
    "山东省",
    "河南省",
    "湖北省",
    "湖南省",
    "广东省",
    "广西壮族自治区",
    "海南省",
    "重庆市",
    "四川省",
    "贵州省",
    "云南省",
    "西藏自治区",
    "陕西省",
    "甘肃省",
    "青海省",
    "宁夏回族自治区",
    "新疆维吾尔自治区",
)


class City(Schema):
    id: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    adm1: str = Field(min_length=1, max_length=40)
    adm2: str = Field(default="", max_length=80)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    source: Literal["qweather", "manual"]

    @model_validator(mode="after")
    def mainland(self) -> "City":
        if self.adm1 not in MAINLAND_PROVINCES or not self.name.strip():
            raise ValueError("仅支持中国大陆城市")
        if self.source == "manual":
            if self.id is not None or self.latitude is not None or self.longitude is not None:
                raise ValueError("手填城市不伪造位置标识或坐标")
        elif self.id is None or self.latitude is None or self.longitude is None:
            raise ValueError("和风城市缺少位置数据")
        return self


class LocationView(Schema):
    city: City | None
    version: int


class LocationPatch(Schema):
    city: City | None
    expected_version: int = Field(ge=1)


class WeatherReading(Schema):
    source: Literal["qweather"] = "qweather"
    kind: Literal["current", "daily"]
    city: City
    observed_at: datetime | None = None
    fetched_at: datetime
    valid_for: date
    expires_at: datetime
    temperature_c: float | None = None
    feels_like_c: float | None = None
    minimum_c: float | None = None
    maximum_c: float | None = None
    condition: str
    precipitation_mm: float | None = None
    stale: bool = False
    attribution: list[str]


class WeatherResult(Schema):
    city: City
    current: WeatherReading | None = None
    daily: WeatherReading | None = None
    errors: list[str] = []


class ManualWeather(Schema):
    temperature_c: float = Field(ge=-90, le=60, allow_inf_nan=False)
    condition: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def nonempty(self) -> "ManualWeather":
        self.condition = self.condition.strip()
        if not self.condition:
            raise ValueError("天气现象不能为空")
        return self
