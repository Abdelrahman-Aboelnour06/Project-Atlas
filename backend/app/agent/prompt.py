import copy
import json

def _strip_pii(dom_map: list) -> list:
    """Masks sensitive user inputs before the LLM sees them."""
    safe_dom = copy.deepcopy(dom_map)
    sensitive_types = {'password', 'email', 'tel', 'number', 'credit-card'}
    sensitive_keywords = ['card', 'cvv', 'ssn', 'password', 'phone', 'email']

    for node in safe_dom:
        node_type = str(node.get('type', '')).lower()
        node_id = str(node.get('id', '')).lower()
        node_name = str(node.get('name', '')).lower()

        is_sensitive = (
            node_type in sensitive_types or
            any(kw in node_id for kw in sensitive_keywords) or
            any(kw in node_name for kw in sensitive_keywords)
        )

        if is_sensitive or str(node.get('tag', '')).lower() == 'input':
            if node.get('inner_text'):
                node['inner_text'] = '[REDACTED]'
                
    return safe_dom

def build_prompt(dom_map: list, command: str) -> str:
    """Builds the command pipeline prompt using safely scrubbed data."""
    safe_dom = _strip_pii(dom_map)
    dom_json = json.dumps(safe_dom, indent=2)
    
    system_prompt = """
    You are an accessibility assistant. Return ONLY raw JSON.
    Format: {"action": "click|fill|scroll|focus|none", "element_id": "id", "value": "text"}
    """
    
    fallback_hint = ""
    if len(safe_dom) < 3:
        fallback_hint = "\nHint: There are very few elements here. If the command does not match, return action 'none'."

    return f"{system_prompt}{fallback_hint}\n\nDOM MAP:\n{dom_json}\n\nUSER COMMAND: {command}\n\nJSON response:"