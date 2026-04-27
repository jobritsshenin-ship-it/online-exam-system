import redis

from app.core.config import settings


redis_client = redis.Redis.from_url(
    settings.redis_url,
    decode_responses=True,
)


def check_redis_connection() -> bool:
    try:
        return bool(redis_client.ping())
    except redis.RedisError:
        return False


def set_value(key: str, value: str, expiry_seconds: int | None = None) -> bool:
    try:
        return bool(redis_client.set(name=key, value=value, ex=expiry_seconds))
    except redis.RedisError:
        return False


def get_value(key: str) -> str | None:
    try:
        return redis_client.get(name=key)
    except redis.RedisError:
        return None


def increment_counter(key: str, expiry_seconds: int | None = None) -> int | None:
    try:
        value = redis_client.incr(key)
        if expiry_seconds is not None:
            redis_client.expire(key, expiry_seconds)
        return int(value)
    except redis.RedisError:
        return None


def delete_value(key: str) -> bool:
    try:
        return bool(redis_client.delete(key))
    except redis.RedisError:
        return False
