"""
Multi-Step Goal Execution Contracts
backend/app/models/goal.py

Defines core Pydantic v2 contracts for goal-directed multi-step navigation:
- PlanStep: Individual atomic action step
- AgenticPlan: Multi-step plan wrapper
- Milestone: Discrete progress checkpoint
- VerifierResult: Observable outcome assessment
- GoalState: Stateful persistent tracking across hops
- GoalStepRequest: Input payload to POST /v1/chat/goal_step
- GoalStepResponse: Return payload from POST /v1/chat/goal_step
"""

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, PrivateAttr, field_validator, model_validator

from app.models.action import ActionType
from app.models.dom import DomNode, coerce_dom_map


# ── Action & Step Definitions ──────────────────────────────────────────────────

PlanStepReason = Literal["reveal_menu", "navigate", "search", "backtrack", "act"]


class PlanStep(BaseModel):
    """Atomic interactive browser action step."""
    action: ActionType = Field(..., description="Action type: click, open, double_click, triple_click, fill, scroll, focus, reveal, switch_tab")
    element_id: Optional[str] = Field(default=None, description="Synthetic data-atlas-id of the target DOM element")
    value: Optional[str] = Field(default=None, description="Input string value when action is 'fill'")
    click_count: Optional[int] = Field(default=None, description="Number of clicks to perform when action is click")
    description: Optional[str] = Field(default="", description="Human-readable description of this step")
    delay_ms: Optional[int] = Field(default=600, description="Execution delay in milliseconds before next action")
    tab_id: Optional[int] = Field(default=None, description="Target browser tab ID for multi-tab actions (e.g. switch_tab)")
    reason: Optional[PlanStepReason] = Field(default=None, description="Exploration rationale: reveal_menu, navigate, search, backtrack, act")
    expect: Optional[str] = Field(default=None, description="Expected observable outcome or element appearance after step execution")
    same_tab: Optional[bool] = Field(default=None, description="Prefer navigating within the same tab")



class AgenticPlan(BaseModel):
    """Backward-compatible agentic action plan structure."""
    type: str = Field(default="plan", description="'plan', 'conversation', or 'confirmation'")
    thought: Optional[str] = Field(default="", description="Internal reasoning leading to the plan")
    reply: str = Field(..., description="Friendly user-facing conversational reply or audio TTS summary")
    steps: List[PlanStep] = Field(default_factory=list, description="Action steps to execute")
    requires_confirmation: bool = Field(default=False, description="Flag indicating human-in-the-loop confirmation is required")
    confirmation_prompt: Optional[str] = Field(default=None, description="Clear prompt explaining the consequential action")
    confirmation_options: Optional[List[str]] = Field(default_factory=lambda: ["Yes, proceed", "No, cancel"])
    pending_step: Optional[PlanStep] = Field(default=None, description="The consequential action step held pending confirmation")
    confirmation_success_message: Optional[str] = Field(default="Done! Action completed.")


# ── Milestone & Verification Definitions ───────────────────────────────────────

MilestoneStatus = Literal["pending", "active", "completed", "failed"]


class Milestone(BaseModel):
    """
    Discrete milestone checkpoint within a multi-step goal.
    In Phase 1, the entire goal constitutes a single implicit active milestone.
    """
    id: str = Field(default="m-0", description="Unique milestone identifier (e.g. 'm-0', 'm-1')")
    description: str = Field(..., description="Human-readable description of what this milestone accomplishes")
    status: MilestoneStatus = Field(default="active", description="Status: pending, active, completed, failed")
    target_url: Optional[str] = Field(default=None, description="Target URL or URL pattern expected on completion")
    success_criteria: Optional[str] = Field(default=None, description="Observable criteria for verification")
    steps: List[PlanStep] = Field(default_factory=list, description="Plan steps associated with this milestone")
    notes: Optional[str] = Field(default=None, description="Internal reasoning notes")
    is_final: bool = Field(default=True, description="True if milestone represents final goal completion")
    satisfied_by_navigation: bool = Field(default=False, description="True if navigation alone satisfies milestone")
    branch_id: str = Field(default="b-0", description="Branch identifier")


VerifierStatus = Literal["milestone_complete", "in_progress", "goal_complete", "goal_failed"]
VerificationMethod = Literal["rules", "llm", "initial"]


class VerifierResult(BaseModel):
    """Outcome verification evaluating post-action state against observable signals."""
    status: VerifierStatus = Field(..., description="Outcome: milestone_complete, in_progress, goal_complete, goal_failed")
    reason: str = Field(..., description="Explanation of verification determination")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Verification confidence score (0.0 - 1.0)")
    signals_detected: List[str] = Field(default_factory=list, description="Observable signals detected (e.g. 'url_changed', 'element_disappeared:atlas-001')")
    verification_method: VerificationMethod = Field(default="rules", description="Method employed: 'rules', 'llm', or 'initial'")


# ── Goal State & Multi-Step Turn Payloads ──────────────────────────────────────

GoalOverallStatus = Literal[
    "in_progress",
    "milestone_complete",
    "goal_complete",
    "goal_failed",
    "requires_confirmation",
    "awaiting_user_input",
    "requires_origin_confirmation",
]


class FieldPlan(BaseModel):
    ref: str = Field(..., description="Stable element ref of target field")
    action: ActionType = Field(default="fill", description="Action to perform: fill, select_option, set_checkbox, set_radio, upload_file")
    value: Optional[str] = Field(default=None, description="Input string value or vault token e.g. '{password}', '{profile.email}'")
    source: Literal["profile", "user", "generated", "default", "vault"] = Field(default="user")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    rationale: Optional[str] = Field(default=None, description="Explanation for this field mapping")


class FormPlan(BaseModel):
    form_id: str = Field(default="", description="Identifier of the target form")
    fields: List[FieldPlan] = Field(default_factory=list, description="Fields to fill in batch")
    submit_ref: Optional[str] = Field(default=None, description="Held-back submit control ref (never in fields)")
    missing_required: List[str] = Field(default_factory=list, description="Refs for required fields lacking values")
    blockers: List[str] = Field(default_factory=list, description="Observed blockers e.g. captcha, otp")


class Budget(BaseModel):
    max_hops: int = Field(default=8, description="Maximum navigations / page transitions")
    hop_count: int = Field(default=0, description="Navigations completed")
    max_field_ops: int = Field(default=40, description="Maximum field operations")
    field_ops: int = Field(default=0, description="Field operations completed")
    max_llm_calls: int = Field(default=25, description="Maximum total LLM calls across all agents")
    llm_calls: int = Field(default=0, description="LLM calls completed")
    max_handoffs: int = Field(default=4, description="Maximum tab handoffs permitted")
    handoff_count: int = Field(default=0, description="Tab handoffs completed")


class Branch(BaseModel):
    id: str = Field(default="b-0", description="Branch identifier")
    milestone_ids: List[str] = Field(default_factory=list, description="Milestone IDs assigned to this branch")
    tab_id: Optional[int] = Field(default=None, description="Browser tab ID if running parallel")
    status: Literal["pending", "active", "done", "failed"] = Field(default="pending")
    depends_on: List[str] = Field(default_factory=list, description="Prerequisite branch IDs")


InputFieldKind = Literal[
    "text",
    "number",
    "select",
    "date",
    "phone",
    "email",
    "password",
    "otp",
    "other",
]


class InputField(BaseModel):
    """Structured field specification for multi-field user input requests."""
    ref: str = Field(..., description="Stable DOM element ref")
    label: Optional[str] = Field(default=None, description="Human-readable field label")
    kind: InputFieldKind = Field(default="text", description="Field type: text, number, select, date, phone, email, password, otp, other")
    sensitive: bool = Field(default=False, description="Whether field value is sensitive/secret")
    pattern: Optional[str] = Field(default=None, description="Validation regex pattern")
    maxlength: Optional[int] = Field(default=None, description="Maximum character length")
    required: bool = Field(default=True, description="Whether input is mandatory")
    options: List[str] = Field(default_factory=list, description="Selectable options for select kind")


class UserInputRequest(BaseModel):
    kind: Literal["otp", "captcha", "choice", "missing_field", "credential"] = Field(..., description="Type of user input requested")
    prompt: str = Field(..., description="Human-readable explanation of needed input")
    field_ref: Optional[str] = Field(default=None, description="Associated DOM ref")
    options: List[str] = Field(default_factory=list, description="Selectable options if kind is choice")
    resumable: bool = Field(default=True, description="Whether goal can resume once supplied")
    fields: List[InputField] = Field(default_factory=list, description="Structured input fields for multi-field user input requests")


class GoalState(BaseModel):
    """
    Persistent state tracking across multi-step execution hops.
    Passed between browser client and backend on every turn.
    """
    goal: str = Field(..., description="Original user goal statement")
    milestones: List[Milestone] = Field(default_factory=list, description="List of milestone checkpoints")
    active_milestone_id: Optional[str] = Field(default=None, description="ID of currently active milestone")
    hop_count: int = Field(default=0, ge=0, description="Number of navigation/execution hops completed")
    max_hops: int = Field(default=8, ge=1, description="Strict safety boundary limit for hops (default 8)")
    status: GoalOverallStatus = Field(default="in_progress", description="Current overall execution status")
    current_url: Optional[str] = Field(default=None, description="Current page URL")
    dom_state: Optional[Dict[str, Any]] = Field(default=None, description="Snapshot/fingerprint of DOM state from previous hop")
    last_action_result: Optional[Dict[str, Any]] = Field(default=None, description="Execution outcome of previous client action")
    plan_steps: List[PlanStep] = Field(default_factory=list, description="Cumulative plan steps executed across hops")
    verifier_result: Optional[VerifierResult] = Field(default=None, description="Result of last verification evaluation")
    requires_confirmation: bool = Field(default=False, description="Consequential action confirmation gate")
    confirmation_prompt: Optional[str] = Field(default=None, description="Prompt asking user to confirm consequential action")
    confirmation_options: Optional[List[str]] = Field(default_factory=lambda: ["Yes, proceed", "No, cancel"])
    pending_step: Optional[PlanStep] = Field(default=None, description="Step held for human confirmation")
    error_message: Optional[str] = Field(default=None, description="Error explanation if status is 'goal_failed'")

    # v2 extensions (§9.5)
    branches: List[Branch] = Field(default_factory=lambda: [Branch()])
    budget: Budget = Field(default_factory=Budget)
    awaiting: Optional[UserInputRequest] = None
    trace_id: Optional[str] = None
    page_kind: Optional[str] = None
    form_plan: Optional[FormPlan] = None
    language: Optional[str] = Field(default=None, description="Preferred language locale e.g. 'ar-EG'")

    def is_terminal(self) -> bool:
        """Returns True if goal execution has reached a terminal state."""
        return self.status in ("goal_complete", "goal_failed")

    def exceeded_max_hops(self) -> bool:
        """Returns True if hop_count has reached or exceeded max_hops."""
        return self.hop_count >= self.max_hops

    def get_active_milestone(self) -> Optional[Milestone]:
        """Returns the currently active Milestone instance, if one exists."""
        if not self.active_milestone_id:
            return self.milestones[0] if self.milestones else None
        for m in self.milestones:
            if m.id == self.active_milestone_id:
                return m
        return self.milestones[0] if self.milestones else None

    def next_pending_milestone(self, branch_id: Optional[str] = None) -> Optional[Milestone]:
        """Returns the next pending milestone after active_milestone, optionally within branch_id."""
        found_active = False
        for m in self.milestones:
            if branch_id and getattr(m, "branch_id", None) and m.branch_id != branch_id:
                continue
            if not found_active:
                if m.id == self.active_milestone_id:
                    found_active = True
                continue
            if m.status == "pending":
                return m
        for m in self.milestones:
            if branch_id and getattr(m, "branch_id", None) and m.branch_id != branch_id:
                continue
            if m.status == "pending" and m.id != self.active_milestone_id:
                return m
        return None

    def advance_hop(self) -> None:
        """Increments hop_count and enforces the strict safety boundary."""
        self.hop_count += 1
        if self.budget:
            self.budget.hop_count = self.hop_count
        if self.hop_count >= self.max_hops and self.status != "goal_complete":
            self.status = "goal_failed"
            self.error_message = f"Goal execution stopped: reached maximum allowed hops limit ({self.max_hops})."


# ── Multi-Tab Coordination Models (Milestone 2 / Track R1 & R2) ───────────────

class TabInfo(BaseModel):
    """Information about a browser tab or popup window tracked in multi-tab sessions."""
    tab_id: int = Field(..., description="Unique browser tab ID")
    url: str = Field(..., description="Sanitized page URL (query & hash stripped)")
    title: Optional[str] = Field(default=None, max_length=80, description="Page title capped at 80 characters")
    is_active: bool = Field(default=False, description="Whether this tab is currently the active foreground tab")
    is_opener: bool = Field(default=False, description="Whether this tab opened the child window/tab")
    is_child: bool = Field(default=False, description="Whether this tab is a child popup/tab")
    status: Optional[str] = Field(default=None, description="Tab load status (e.g. 'complete', 'loading')")
    window_id: Optional[int] = Field(default=None, description="Browser window ID containing this tab")
    created_at: Optional[float] = Field(default=None, description="Creation timestamp")


class TabContext(BaseModel):
    """Multi-tab coordination context passed between browser client and backend."""
    self_tab_id: int = Field(..., description="Tab ID executing this step")
    opener_tab_id: Optional[int] = Field(default=None, description="Opener tab ID if child popup")
    tabs: List[TabInfo] = Field(default_factory=list, description="All tabs tracked in active session")
    resume_reason: Optional[str] = Field(default=None, description="Resume reason: initial, child_ready, popup_blocked, etc.")
    close_hint: bool = Field(default=False, description="Hint if child is ready to be closed")
    origin_confirmed: bool = Field(default=False, description="User confirmed cross-origin boundary")


class GoalStepRequest(BaseModel):
    """Payload sent from browser extension or test harness to POST /v1/chat/goal_step."""
    goal: str = Field(..., max_length=2000, description="Natural language user goal")
    current_url: str = Field(..., max_length=2048, description="Current page URL")
    dom_map: List[DomNode] = Field(default_factory=list, description="Serialized interactive DOM elements on current page")
    page_text: Optional[str] = Field(default=None, max_length=50000, description="Extracted visible text from page")
    goal_state: Optional[GoalState] = Field(default=None, description="Existing GoalState from prior hop, or None if initial")
    last_action_result: Optional[Dict[str, Any]] = Field(default=None, description="Feedback from executor for the previous step")
    user_response: Optional[str] = Field(default=None, max_length=1000, description="User response to confirmation prompt (e.g. 'yes', 'no')")
    user_inputs: Optional[Dict[str, str]] = Field(default=None, description="Structured mapping of field ref -> value or secret-vault token")
    session_id: Optional[str] = Field(default=None, max_length=256, description="Session ID for tracking and correlation")
    api_key: Optional[str] = Field(default=None, max_length=256, description="Optional inline tenant API key")
    language: Optional[str] = Field(default=None, max_length=32, description="Preferred language locale e.g. 'ar-EG'")
    contract_version: int = Field(default=2, description="Contract version: 1 (legacy), 2 (multi-tab aware), 3 (exploration & input fields)")
    capabilities: List[str] = Field(
        default_factory=lambda: ["switch_tab", "tab_context", "assisted_click"],
        description="Client declared capabilities",
    )
    tab_context: Optional[TabContext] = Field(default=None, description="Multi-tab session context")

    @field_validator("dom_map", mode="before")
    @classmethod
    def _validate_dom_map(cls, v: Any) -> List[DomNode]:
        return coerce_dom_map(v)

    @classmethod
    def model_json_schema(cls, *args: Any, **kwargs: Any) -> Dict[str, Any]:
        schema = super().model_json_schema(*args, **kwargs)
        defs = schema.get("$defs", {})
        if "PlanStep" in defs:
            defs["PlanStep"]["properties"].pop("same_tab", None)
        if "DomNode" in defs:
            for k in ("opens_new_tab", "target_origin", "in_modal", "blocked_by_modal"):
                defs["DomNode"]["properties"].pop(k, None)
        if "GoalState" in defs and "status" in defs["GoalState"]["properties"]:
            enum_list = defs["GoalState"]["properties"]["status"].get("enum", [])
            if "requires_origin_confirmation" in enum_list:
                enum_list.remove("requires_origin_confirmation")
        return schema



class GoalStepResponse(BaseModel):
    """Response payload returned by POST /v1/chat/goal_step to the browser client."""
    status: GoalOverallStatus = Field(..., description="Current status: in_progress, milestone_complete, goal_complete, goal_failed, requires_confirmation")
    goal_state: GoalState = Field(..., description="Updated persistent goal state")
    reply: str = Field(..., description="User-facing conversational feedback or audio message")
    steps: List[PlanStep] = Field(default_factory=list, description="Action steps to execute in the current turn")
    plan: Optional[AgenticPlan] = Field(default=None, description="AgenticPlan representation for backward-compatibility")
    requires_confirmation: bool = Field(default=False, description="Consequential action confirmation gate")
    confirmation_prompt: Optional[str] = Field(default=None, description="Confirmation prompt text if confirmation is required")
    confirmation_options: Optional[List[str]] = Field(default_factory=lambda: ["Yes, proceed", "No, cancel"])
    pending_step: Optional[PlanStep] = Field(default=None, description="Consequential action awaiting confirmation")
    verifier_result: Optional[VerifierResult] = Field(default=None, description="Verification outcome from evaluating previous action")
    contract_version: int = Field(default=2, description="Contract version: 1 (legacy), 2 (multi-tab aware), 3 (exploration & input fields)")
    close_tab: Optional[bool] = Field(default=None, description="Directive to close child tab")
    switch_tab_id: Optional[int] = Field(default=None, description="Directive to switch active tab")
    requires_origin_confirmation: bool = Field(default=False, description="Gate for cross-origin confirmation")
    assisted_click: Optional[Dict[str, Any]] = Field(default=None, description="Assisted click prompt configuration")

    @classmethod
    def model_json_schema(cls, *args: Any, **kwargs: Any) -> Dict[str, Any]:
        schema = super().model_json_schema(*args, **kwargs)
        defs = schema.get("$defs", {})
        if "PlanStep" in defs:
            defs["PlanStep"]["properties"].pop("same_tab", None)
        if "DomNode" in defs:
            for k in ("opens_new_tab", "target_origin", "in_modal", "blocked_by_modal"):
                defs["DomNode"]["properties"].pop(k, None)
        if "GoalState" in defs and "status" in defs["GoalState"]["properties"]:
            enum_list = defs["GoalState"]["properties"]["status"].get("enum", [])
            if "requires_origin_confirmation" in enum_list:
                enum_list.remove("requires_origin_confirmation")
        if "status" in schema.get("properties", {}):
            enum_list = schema["properties"]["status"].get("enum", [])
            if "requires_origin_confirmation" in enum_list:
                enum_list.remove("requires_origin_confirmation")
        return schema
