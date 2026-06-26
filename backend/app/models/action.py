from typing import Literal
from pydantic import BaseModel


class ActionResponse(BaseModel):
    status:     Literal["success", "error"]
    action:     Literal["click", "fill", "scroll", "focus"] | None
    element_id: str | None
    value:      str | None
    message:    str

    @classmethod
    def error(cls, message: str) -> "ActionResponse":
        return cls(
            status="error",
            action=None,
            element_id=None,
            value=None,
            message=message,
        )
