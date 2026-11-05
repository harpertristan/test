from abc import ABC, abstractmethod


class AIResponder(ABC):
    @abstractmethod
    async def draft(self, message: dict, rules: list[dict]) -> str:
        raise NotImplementedError


class DisabledAIResponder(AIResponder):
    async def draft(self, message: dict, rules: list[dict]) -> str:
        raise NotImplementedError("Автоответчик не включён: этап 2")
