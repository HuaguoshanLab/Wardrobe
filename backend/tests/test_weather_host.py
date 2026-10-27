import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.mark.parametrize("host", ["", "test.qweatherapi.com", "account.re.qweatherapi.com"])
def test_supported_weather_host(host):
    assert Settings(qweather_host=host).qweather_host == host


@pytest.mark.parametrize(
    "host",
    [
        "https://test.qweatherapi.com",
        "test.qweatherapi.com/",
        "test.qweatherapi.com.evil.com",
        "test..qweatherapi.com",
        "-test.qweatherapi.com",
        "test_.qweatherapi.com",
        "test.qweatherapi.com:443",
        "user@test.qweatherapi.com",
    ],
)
def test_invalid_weather_host(host):
    with pytest.raises(ValidationError):
        Settings(qweather_host=host)
