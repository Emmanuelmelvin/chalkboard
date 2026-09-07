"""Structured logger (mirrors src/utils/logger.ts winston json style)."""

import logging
import os

_configured = False


def get_logger(name: str = "agent-service") -> logging.Logger:
    global _configured
    level_name = os.environ.get("LOG_LEVEL", "").upper()
    if not level_name:
        level_name = "INFO" if os.environ.get("NODE_ENV") == "production" else "DEBUG"
    level = getattr(logging, level_name, logging.DEBUG)
    logger = logging.getLogger(name)
    if not _configured:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
        root = logging.getLogger()
        if not root.handlers:
            root.addHandler(handler)
        root.setLevel(level)
        logger.setLevel(level)
        _configured = True
    return logger


logger = get_logger()
