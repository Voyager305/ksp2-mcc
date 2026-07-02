import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


# Where the game (MccLink mod) is listening. When the backend runs in Docker
# and the game on the host, this must be host.docker.internal.
KSP_BRIDGE_HOST = os.environ.get("KSP_BRIDGE_HOST", "host.docker.internal")
KSP_BRIDGE_PORT = _int("KSP_BRIDGE_PORT", 8766)

# ---------------------------------------------------------------- LLM (OpenAI-совместимый)
# По умолчанию — Cloud.ru Foundation Models. Подходит любой OpenAI-совместимый
# эндпоинт (Cloud.ru, OpenAI, vLLM, Ollama, LM Studio, OpenRouter и т.п.).
MCC_BASE_URL = os.environ.get(
    "MCC_BASE_URL", "https://foundation-models.api.cloud.ru/v1"
)
# Ключ API. Принимаем несколько привычных имён переменных.
MCC_API_KEY = (
    os.environ.get("MCC_API_KEY")
    or os.environ.get("OPENAI_API_KEY")
    or os.environ.get("CLOUD_RU_API_KEY")
    or ""
)
# ID модели у провайдера. Для Cloud.ru, например: "deepseek-ai/DeepSeek-V3",
# "Qwen/Qwen2.5-72B-Instruct". Модель ДОЛЖНА поддерживать function calling.
MCC_MODEL = os.environ.get("MCC_MODEL", "deepseek-ai/DeepSeek-V3")

MCC_MAX_TOKENS = _int("MCC_MAX_TOKENS", 4096)
MCC_TEMPERATURE = _float("MCC_TEMPERATURE", 0.3)
# Max tool-call steps per directive. 0 = unlimited (run until the agent finishes).
MCC_MAX_TOOL_ITERATIONS = _int("MCC_MAX_TOOL_ITERATIONS", 0)
# To keep the LLM context from overflowing on long missions, telemetry results
# older than the most recent N tool calls are compacted to a short placeholder.
MCC_KEEP_RECENT_TOOL_RESULTS = _int("MCC_KEEP_RECENT_TOOL_RESULTS", 24)
# Некоторые провайдеры/модели не поддерживают stream=true вместе с tools.
MCC_STREAM = os.environ.get("MCC_STREAM", "1") not in ("0", "false", "False")

# Storage
DB_PATH = os.environ.get("MCC_DB_PATH", "/data/mcc.db")

# Telemetry history kept in memory (seconds, at ~1 sample/sec stored)
TELEMETRY_HISTORY_SECONDS = _int("TELEMETRY_HISTORY_SECONDS", 7200)
