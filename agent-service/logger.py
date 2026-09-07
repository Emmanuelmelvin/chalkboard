"""Structured logger (mirrors src/utils/logger.ts winston json style)."""

import logging
import os

_configured = False

_QUIET_LIBS = (
    "socketio",
    "engineio",
    "litellm",
    "LiteLLM",
    "boto3",
    "botocore",
    "urllib3",
    "google",
    "genai",
    "werkzeug",
)


def get_logger(name: str = "agent-service") -> logging.Logger:
    global _configured
    level_name = os.environ.get("LOG_LEVEL", "").upper() or "INFO"
    level = getattr(logging, level_name, logging.INFO)
    logger = logging.getLogger(name)
    if not _configured:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
        root = logging.getLogger()
        if not root.handlers:
            root.addHandler(handler)
        # Keep our service at LOG_LEVEL, but never let third-party
        # libs inherit DEBUG from development defaults.
        root.setLevel(logging.WARNING)
        logger.setLevel(level)
        logger.propagate = False
        logger.addHandler(handler)
        for lib in _QUIET_LIBS:
            # LiteLLM factory warning is noisy even with modify_params,
            # keep it at ERROR unless debugging
            lvl = logging.ERROR if lib.lower() == "litellm" else logging.WARNING
            logging.getLogger(lib).setLevel(lvl)
        # also silence the explicit LiteLLM factory logger name
        logging.getLogger("LiteLLM").setLevel(logging.ERROR)
        logging.getLogger("litellm").setLevel(logging.ERROR)
        _configured = True
    return logger


logger = get_logger()
