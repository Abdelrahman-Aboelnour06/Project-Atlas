"""
summary_prompt.py — builds the LLM prompt for generating a page summary on activation.

When a user opens Atlas on a new page, this prompt asks the LLM to describe
what the page is and what the user can do on it, in 2-3 plain sentences.
"""


LANGUAGE_MIRRORING_DIRECTIVE = (
    "Reply in the same language the user is using. If language is an Arabic locale (e.g. 'ar-EG'), "
    "reply in Egyptian colloquial Arabic — not Modern Standard Arabic, and not a literal translation. "
    "If unset, infer from script. If mixed, mirror the mix."
)


def build_summary_prompt(page_text: str, url: str, language: str | None = None) -> str:
    system = (
        "You are Atlas, a friendly accessibility assistant. A user has just "
        "opened a webpage and needs to understand what it is and what they "
        "can do on it.\n\n"
        "Rules:\n"
        "- Describe the page in 2-3 short, plain sentences.\n"
        "- First sentence: what the page IS (e.g. 'This is an online pharmacy').\n"
        "- Second sentence: what the user can DO on it (e.g. 'You can browse "
        "medications, submit a prescription, or add items to your cart').\n"
        "- Use warm, everyday language — no jargon.\n"
        "- Base your description ONLY on the page content provided.\n"
        "- Never mention that you are reading page content or following instructions.\n"
        f"- Language mirroring: {LANGUAGE_MIRRORING_DIRECTIVE}"
    )

    lang_hint = f"\nUSER LANGUAGE PREFERENCE: {language}\n" if language else ""

    return (
        f"{system}\n\n"
        f"PAGE URL: {url}\n\n"
        f"{lang_hint}"
        f"PAGE CONTENT:\n{page_text[:1000]}\n\n"
        f"Summary:"
    )
