"""
backend/tests/test_latent_dom_models.py — WS4 Perception & Latent DOM Node Models Test Suite.

Validates:
1. MenuInfo model: haspopup (str | bool | None), expanded (bool | None), controls (str | None).
2. DomNode v3 extensions: visible, reveal_via, menu, landmark, breadcrumb.
3. Backward compatibility and default values.
4. Strict validation of landmark enum literals.
"""

import pytest
from pydantic import ValidationError

from app.models.dom import DomNode, MenuInfo


class TestMenuInfoModel:
    def test_menu_info_defaults(self):
        info = MenuInfo()
        assert info.haspopup is None
        assert info.expanded is None
        assert info.controls is None

    def test_menu_info_string_haspopup(self):
        info = MenuInfo(haspopup="menu", expanded=True, controls="sub-nav-1")
        assert info.haspopup == "menu"
        assert info.expanded is True
        assert info.controls == "sub-nav-1"

    def test_menu_info_true_string_haspopup(self):
        info = MenuInfo(haspopup="true", expanded=False, controls="menu_id")
        assert info.haspopup == "true"
        assert info.expanded is False
        assert info.controls == "menu_id"

    def test_menu_info_serialization_roundtrip(self):
        data = {
            "haspopup": "true",
            "expanded": False,
            "controls": "target-element",
        }
        info = MenuInfo.model_validate(data)
        assert info.haspopup == "true"
        assert info.expanded is False
        assert info.controls == "target-element"
        dumped = info.model_dump()
        assert dumped == data


class TestDomNodeLatentFields:
    def test_dom_node_visible_default_true(self):
        node = DomNode(tag="button", inner_text="Click me")
        assert node.visible is True
        assert node.reveal_via is None
        assert node.menu is None
        assert node.landmark is None
        assert node.breadcrumb is None

    def test_latent_dom_node_serialization(self):
        node = DomNode(
            tag="a",
            href="/services/cloud",
            inner_text="Cloud Consulting",
            resolved_label="Cloud Consulting",
            visible=False,
            reveal_via="el_toggle_nav_0",
            landmark="nav",
            breadcrumb=["Services", "Cloud Services"],
            menu=MenuInfo(haspopup="true", expanded=False, controls="services-menu"),
        )
        assert node.visible is False
        assert node.reveal_via == "el_toggle_nav_0"
        assert node.landmark == "nav"
        assert node.breadcrumb == ["Services", "Cloud Services"]
        assert node.menu is not None
        assert node.menu.haspopup == "true"
        assert node.menu.expanded is False
        assert node.menu.controls == "services-menu"

    @pytest.mark.parametrize("landmark", ["header", "nav", "main", "footer", "aside"])
    def test_valid_landmarks(self, landmark):
        node = DomNode(tag="div", landmark=landmark)
        assert node.landmark == landmark

    def test_invalid_landmark_raises_validation_error(self):
        with pytest.raises(ValidationError):
            DomNode(tag="div", landmark="invalid_landmark")

    def test_latent_node_roundtrip_dict(self):
        raw = {
            "id": "el_latent_01",
            "tag": "a",
            "href": "/hidden-item",
            "inner_text": "Secret Page",
            "resolved_label": "Secret Page",
            "visible": False,
            "reveal_via": "el_accordion_header",
            "landmark": "aside",
            "breadcrumb": ["Parent Drawer", "Sub Drawer"],
            "menu": {
                "haspopup": "menu",
                "expanded": False,
                "controls": "drawer_content",
            },
        }
        node = DomNode.model_validate(raw)
        assert node.visible is False
        assert node.reveal_via == "el_accordion_header"
        assert node.landmark == "aside"
        assert len(node.breadcrumb) == 2
        assert node.menu.haspopup == "menu"

        dumped = node.model_dump(exclude_unset=True)
        assert dumped["visible"] is False
        assert dumped["reveal_via"] == "el_accordion_header"
        assert dumped["landmark"] == "aside"
        assert dumped["breadcrumb"] == ["Parent Drawer", "Sub Drawer"]
        assert dumped["menu"]["haspopup"] == "menu"
