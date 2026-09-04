"""Custom error class for the agent-service (mirrors src/utils/errors.ts)."""


class AgentError(Exception):
    def __init__(self, code: str, message: str | None = None):
        super().__init__(message or code)
        self.code = code
