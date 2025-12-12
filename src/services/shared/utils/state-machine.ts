/**
 * FIX #46: Missing Conditional Writes
 * 
 * Implements state machine enforcement for calls and agents
 * to prevent invalid state transitions.
 */

export type CallStatus = 
  | 'queued' 
  | 'ringing' 
  | 'accepting'  // FIX #3: Add intermediate state for call acceptance
  | 'connected' 
  | 'on_hold' 
  | 'transferring' 
  | 'completed' 
  | 'abandoned' 
  | 'escalated' 
  | 'failed';

export type AgentStatus = 
  | 'Offline' 
  | 'Online' 
  | 'Ringing'  // FIX #2: Add Ringing status for agent state machine
  | 'OnCall';

/**
 * Call state machine defining valid transitions
 * FIX #3: Added 'accepting' as intermediate state for call acceptance
 */
export const CALL_STATE_MACHINE: Record<CallStatus, CallStatus[]> = {
  queued: ['ringing', 'abandoned', 'escalated'],
  ringing: ['accepting', 'connected', 'queued', 'abandoned'],  // FIX: ringing -> accepting
  accepting: ['connected', 'ringing', 'abandoned'],  // FIX: accepting -> connected (success) or ringing (rollback)
  connected: ['on_hold', 'completed', 'transferring'],
  on_hold: ['connected', 'completed', 'abandoned'],
  transferring: ['connected', 'completed', 'failed'],
  completed: [], // Terminal state
  abandoned: [], // Terminal state
  escalated: ['ringing', 'abandoned'], // Supervisor can reassign
  failed: []  // Terminal state
};

/**
 * Agent state machine defining valid transitions
 * FIX #2: Added 'Ringing' state for incoming calls
 */
export const AGENT_STATE_MACHINE: Record<AgentStatus, AgentStatus[]> = {
  Offline: ['Online'],
  Online: ['Ringing', 'OnCall', 'Offline'],  // FIX: Online -> Ringing when call comes in
  Ringing: ['OnCall', 'Online', 'Offline'],  // FIX: Ringing -> OnCall (accept) or Online (reject/timeout)
  OnCall: ['Online', 'Offline'], // Can go offline during call (emergency)
};

/**
 * Check if a state transition is valid
 */
export function isValidStateTransition(
  from: string,
  to: string,
  stateMachine: Record<string, string[]>
): boolean {
  const allowedTransitions = stateMachine[from];
  if (!allowedTransitions) {
    console.warn(`[StateMachine] Unknown state: ${from}`);
    return false;
  }
  return allowedTransitions.includes(to);
}

/**
 * Get all valid next states for a given state
 */
export function getValidNextStates(
  currentState: string,
  stateMachine: Record<string, string[]>
): string[] {
  return stateMachine[currentState] || [];
}

/**
 * Check if a state is terminal (no valid transitions)
 */
export function isTerminalState(
  state: string,
  stateMachine: Record<string, string[]>
): boolean {
  const transitions = stateMachine[state];
  return transitions ? transitions.length === 0 : false;
}

export interface StateTransitionCondition {
  valid: boolean;
  condition: string;
  attributeValues?: Record<string, any>;
  attributeNames?: Record<string, string>;
  error?: string;
}

/**
 * Build a DynamoDB condition expression that enforces state machine rules
 */
export function buildStateTransitionCondition(
  currentState: string,
  newState: string,
  stateMachine: Record<string, string[]>,
  stateAttributeName: string = 'status'
): StateTransitionCondition {
  // Validate transition
  if (!isValidStateTransition(currentState, newState, stateMachine)) {
    return {
      valid: false,
      condition: '',
      error: `Invalid state transition: ${currentState} -> ${newState}`
    };
  }

  // Find all states that can transition to the new state
  const validFromStates = Object.entries(stateMachine)
    .filter(([_, transitions]) => transitions.includes(newState))
    .map(([state, _]) => state);

  // Build condition expression
  const attributeNames: Record<string, string> = {
    '#status': stateAttributeName
  };

  let condition: string;
  let attributeValues: Record<string, any>;

  if (validFromStates.length === 1) {
    // Single valid source state
    condition = '#status = :currentState';
    attributeValues = { ':currentState': currentState };
  } else {
    // Multiple valid source states
    condition = '#status IN (' + validFromStates.map((_, i) => `:state${i}`).join(', ') + ')';
    attributeValues = {};
    validFromStates.forEach((state, i) => {
      attributeValues[`:state${i}`] = state;
    });
  }

  return {
    valid: true,
    condition,
    attributeValues,
    attributeNames
  };
}

/**
 * Build a flexible condition that allows transition from current state OR terminal states
 * (useful for idempotent operations)
 */
export function buildIdempotentStateTransitionCondition(
  currentState: string,
  newState: string,
  stateMachine: Record<string, string[]>,
  stateAttributeName: string = 'status'
): StateTransitionCondition {
  const baseCondition = buildStateTransitionCondition(
    currentState,
    newState,
    stateMachine,
    stateAttributeName
  );

  if (!baseCondition.valid) {
    return baseCondition;
  }

  // If the new state is terminal, allow idempotent writes
  if (isTerminalState(newState, stateMachine)) {
    baseCondition.condition = `(${baseCondition.condition}) OR #status = :targetState`;
    baseCondition.attributeValues![':targetState'] = newState;
  }

  return baseCondition;
}

/**
 * Validate a state transition and throw an error if invalid
 */
export function validateStateTransition(
  from: string,
  to: string,
  stateMachine: Record<string, string[]>,
  entityType: string = 'entity'
): void {
  if (!isValidStateTransition(from, to, stateMachine)) {
    const validStates = getValidNextStates(from, stateMachine);
    throw new Error(
      `Invalid ${entityType} state transition: ${from} -> ${to}. ` +
      `Valid transitions from ${from}: ${validStates.join(', ') || 'none (terminal state)'}`
    );
  }
}

/**
 * Get a human-readable description of valid transitions
 */
export function describeStateMachine(stateMachine: Record<string, string[]>): string {
  const lines = Object.entries(stateMachine).map(([state, transitions]) => {
    if (transitions.length === 0) {
      return `  ${state} -> (terminal)`;
    }
    return `  ${state} -> ${transitions.join(', ')}`;
  });
  return 'Valid state transitions:\n' + lines.join('\n');
}

/**
 * Validate an entire state transition path
 */
export function isValidStatePath(
  states: string[],
  stateMachine: Record<string, string[]>
): boolean {
  if (states.length < 2) {
    return true; // No transitions
  }

  for (let i = 0; i < states.length - 1; i++) {
    if (!isValidStateTransition(states[i], states[i + 1], stateMachine)) {
      return false;
    }
  }

  return true;
}

