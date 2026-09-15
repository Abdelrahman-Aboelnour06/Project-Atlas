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
from pydantic import BaseModel, Field

from app.models.action import ActionType
from app.models.dom import DomNode


# ── Action & Step Definitions ──────────────────────────────────────────────────

class PlanStep(BaseModel):
    """Atomic interactive browser action step."""
    action: ActionType = Field(..., description="Action type: click, open, double_click, fill, scroll, focus")
    element_id: Optional[str] = Field(default=None, description="Synthetic data-atlas-id of the target DOM element")
    value: Optional[str] = Field(default=None, description="Input string value when action is 'fill'")
    description: Optional[str] = Field(default="", description="Human-readable description of this step")
    delay_ms: Optional[int] = Field(default=600, description="Execution delay in milliseconds before next action")


class AgenticPlan(BaseModel):
    """Backward-compatible agentic action plan structure."""
    type: str = Field(default="plan", description="'plan', 'conversation', or 'confirmation'")
    thought: Optional[str] = Field(default="", description="Internal reasoning leading to the plan")
    reply: str = Field(..., description="Friendly user-facing conversational reply or audio TTS summary")
    steps: List[PlanStep] = Field(default_factory=list, description="Action steps to execute")
    requires_confirmation: bool = Field(default=False, description="Flag indicating human-in-the-loop confirmation is required")
    confirmation_prompt: Optional[str] = Field(default=None, description="Clear prompt explaining the consequential action")
    confirmation_options: List[str] = Field(default_factory=lambda: ["Yes, proceed", "No, cancel"])
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
]


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

    def advance_hop(self) -> None:
        """Increments hop_count and enforces the strict safety boundary."""
        self.hop_count += 1
        if self.hop_count >= self.max_hops and self.status != "goal_complete":
            self.status = "goal_failed"
            self.error_message = f"Goal execution stopped: reached maximum allowed hops limit ({self.max_hops})."


class GoalStepRequest(BaseModel):
    """Payload sent from browser extension or test harness to POST /v1/chat/goal_step."""
    goal: str = Field(..., max_length=2000, description="Natural language user goal")
    current_url: str = Field(..., max_length=2048, description="Current page URL")
    dom_map: List[DomNode] = Field(default_factory=list, description="Serialized interactive DOM elements on current page")
    page_text: Optional[str] = Field(default=None, max_length=50000, description="Extracted visible text from page")
    goal_state: Optional[GoalState] = Field(default=None, description="Existing GoalState from prior hop, or None if initial")
    last_action_result: Optional[Dict[str, Any]] = Field(default=None, description="Feedback from executor for the previous step")
    user_response: Optional[str] = Field(default=None, max_length=1000, description="User response to confirmation prompt (e.g. 'yes', 'no')")
    session_id: Optional[str] = Field(default=None, max_length=256, description="Session ID for tracking and correlation")
    api_key: Optional[str] = Field(default=None, max_length=256, description="Optional inline tenant API key")


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
