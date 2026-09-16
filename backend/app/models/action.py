from typing import Literal
from pydantic import BaseModel


ActionType = Literal[
    "click",
    "open",
    "double_click",
    "triple_click",
    "fill",
    "scroll",
    "focus",
    "select_option",
    "set_checkbox",
    "set_radio",
    "press_key",
    "upload_file",
    "wait_for",
]


class ActionResponse(BaseModel):
    status:     Literal["success", "error"]
    action:     ActionType | None
    element_id: str | None
    value:      str | None
    message:    str
    click_count: int | None = None

    @classmethod
    def error(cls, message: str) -> "ActionResponse":
        return cls(
            status="error",
            action=None,
            element_id=None,
            value=None,
            message=message,
            click_count=None,
        )
