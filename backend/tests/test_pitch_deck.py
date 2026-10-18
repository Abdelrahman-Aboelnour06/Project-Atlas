"""
Test Pitch Deck Generator
backend/tests/test_pitch_deck.py
"""

import os
from pptx import Presentation
from scripts.generate_pitch_deck import create_deck


def test_pitch_deck_creation(tmp_path):
    output_file = str(tmp_path / "test_deck.pptx")
    create_deck(output_file)

    assert os.path.exists(output_file)
    prs = Presentation(output_file)
    # Ensure exactly 10 slides are generated
    assert len(prs.slides) == 10
    # Ensure 16:9 widescreen dimensions (13.333 x 7.5 inches)
    assert round(prs.slide_width.inches, 2) == 13.33
    assert round(prs.slide_height.inches, 2) == 7.5
