import copy
from typing import List, Dict, Any

def strip_pii_from_dom(dom_map: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Creates a safe copy of the DOM map, completely masking sensitive user inputs
    before they are sent to the LLM or logged in the database.
    """
    # Create a deep copy so we don't mutate the original incoming request data
    safe_dom = copy.deepcopy(dom_map)
    
    # Define triggers that indicate a field is handling sensitive data
    sensitive_types = {'password', 'email', 'tel', 'number', 'credit-card'}
    sensitive_keywords = ['card', 'cvv', 'ssn', 'password', 'phone', 'email']

    for node in safe_dom:
        node_tag = str(node.get('tag', '')).lower()
        node_type = str(node.get('type', '')).lower()
        node_id = str(node.get('id', '')).lower()
        node_name = str(node.get('name', '')).lower()

        # Flag 1: Is the HTML type explicitly sensitive?
        # Flag 2: Does the ID or Name contain a sensitive keyword?
        is_sensitive = (
            node_type in sensitive_types or
            any(kw in node_id for kw in sensitive_keywords) or
            any(kw in node_name for kw in sensitive_keywords)
        )

        # If it is an input field, we must scrub any typed content
        if is_sensitive or node_tag == 'input':
            # If the user typed something into 'inner_text', nuke it.
            if node.get('inner_text'):
                node['inner_text'] = '[REDACTED_PII]'
            
            # Note: We LEAVE the 'placeholder' and 'aria_label' alone 
            # because the LLM needs those to know what the button/field actually does.

    return safe_dom

def trim_log_payload(command: str, action_response: dict) -> dict:
    """
    Trims the massive data chunks so we don't overload the PostgreSQL DB 
    or store unnecessary user activity history.
    """
    return {
        "command_snippet": command[:100] + "..." if len(command) > 100 else command,
        "resolved_action": action_response.get("action"),
        "target_element": action_response.get("element_id"),
        "status": action_response.get("status")
    }