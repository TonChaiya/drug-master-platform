from __future__ import annotations


class AgentFailure(RuntimeError):
    """Carries a stable code; the message is safe to show and never holds secrets."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class JhcisFailure(AgentFailure):
    pass


class ServerFailure(AgentFailure):
    pass
