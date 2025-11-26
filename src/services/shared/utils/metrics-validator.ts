/**
 * Metrics Validation Layer
 * 
 * Validates agent performance metrics before writing to ensure data quality
 * Prevents invalid data from corrupting analytics
 */

export interface MetricsValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedMetrics?: any;
}

export interface AgentMetricsInput {
  agentId: string;
  clinicId: string;
  callId: string;
  direction: 'inbound' | 'outbound';
  duration: number;
  talkTime?: number;
  holdTime?: number;
  sentiment?: string;
  sentimentScore?: number;
  transferred?: boolean;
  escalated?: boolean;
  issues?: string[];
  speakerMetrics?: {
    agentTalkPercentage: number;
    interruptionCount: number;
  };
}

// Validation thresholds
const VALIDATION_RULES = {
  duration: {
    min: 1,              // 1 second minimum
    max: 14400,          // 4 hours maximum
    warningMax: 3600     // Warn if > 1 hour
  },
  talkTime: {
    min: 0,
    max: 14400
  },
  holdTime: {
    min: 0,
    max: 7200            // 2 hours max hold time
  },
  sentimentScore: {
    min: 0,
    max: 100
  },
  agentTalkPercentage: {
    min: 0,
    max: 100
  },
  interruptionCount: {
    min: 0,
    max: 200             // Unlikely to have >200 interruptions
  }
};

const VALID_SENTIMENTS = ['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED'];
const VALID_DIRECTIONS = ['inbound', 'outbound'];

/**
 * Comprehensive validation of agent metrics
 */
export function validateAgentMetrics(metrics: AgentMetricsInput): MetricsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required field validation
  if (!metrics.agentId || typeof metrics.agentId !== 'string') {
    errors.push('agentId is required and must be a string');
  }

  if (!metrics.clinicId || typeof metrics.clinicId !== 'string') {
    errors.push('clinicId is required and must be a string');
  }

  if (!metrics.callId || typeof metrics.callId !== 'string') {
    errors.push('callId is required and must be a string');
  }

  // Direction validation
  if (!VALID_DIRECTIONS.includes(metrics.direction)) {
    errors.push(`direction must be one of: ${VALID_DIRECTIONS.join(', ')}`);
  }

  // Duration validation
  if (typeof metrics.duration !== 'number' || isNaN(metrics.duration)) {
    errors.push('duration must be a valid number');
  } else {
    if (metrics.duration < VALIDATION_RULES.duration.min) {
      errors.push(`duration must be at least ${VALIDATION_RULES.duration.min} second`);
    }
    if (metrics.duration > VALIDATION_RULES.duration.max) {
      errors.push(`duration cannot exceed ${VALIDATION_RULES.duration.max} seconds (4 hours)`);
    }
    if (metrics.duration > VALIDATION_RULES.duration.warningMax) {
      warnings.push(`duration ${metrics.duration}s is unusually long (>${VALIDATION_RULES.duration.warningMax}s)`);
    }
  }

  // Talk time validation
  if (metrics.talkTime !== undefined) {
    if (typeof metrics.talkTime !== 'number' || isNaN(metrics.talkTime)) {
      errors.push('talkTime must be a valid number');
    } else {
      if (metrics.talkTime < VALIDATION_RULES.talkTime.min) {
        errors.push('talkTime cannot be negative');
      }
      if (metrics.talkTime > VALIDATION_RULES.talkTime.max) {
        errors.push(`talkTime cannot exceed ${VALIDATION_RULES.talkTime.max} seconds`);
      }
      // Talk time should not exceed total duration
      if (metrics.talkTime > metrics.duration) {
        errors.push('talkTime cannot exceed total duration');
      }
    }
  }

  // Hold time validation
  if (metrics.holdTime !== undefined) {
    if (typeof metrics.holdTime !== 'number' || isNaN(metrics.holdTime)) {
      errors.push('holdTime must be a valid number');
    } else {
      if (metrics.holdTime < VALIDATION_RULES.holdTime.min) {
        errors.push('holdTime cannot be negative');
      }
      if (metrics.holdTime > VALIDATION_RULES.holdTime.max) {
        errors.push(`holdTime cannot exceed ${VALIDATION_RULES.holdTime.max} seconds`);
      }
      // Hold time should not exceed total duration
      if (metrics.holdTime > metrics.duration) {
        warnings.push('holdTime exceeds total duration, will be capped');
      }
    }
  }

  // Validate talk + hold <= duration
  if (metrics.talkTime !== undefined && metrics.holdTime !== undefined) {
    if (metrics.talkTime + metrics.holdTime > metrics.duration) {
      warnings.push('talkTime + holdTime exceeds duration, values will be adjusted proportionally');
    }
  }

  // Sentiment validation
  if (metrics.sentiment !== undefined) {
    const sentimentUpper = metrics.sentiment.toUpperCase();
    if (!VALID_SENTIMENTS.includes(sentimentUpper)) {
      errors.push(`sentiment must be one of: ${VALID_SENTIMENTS.join(', ')}`);
    }
  }

  // Sentiment score validation
  if (metrics.sentimentScore !== undefined) {
    if (typeof metrics.sentimentScore !== 'number' || isNaN(metrics.sentimentScore)) {
      errors.push('sentimentScore must be a valid number');
    } else {
      if (metrics.sentimentScore < VALIDATION_RULES.sentimentScore.min ||
          metrics.sentimentScore > VALIDATION_RULES.sentimentScore.max) {
        errors.push(`sentimentScore must be between ${VALIDATION_RULES.sentimentScore.min} and ${VALIDATION_RULES.sentimentScore.max}`);
      }
    }
  }

  // Speaker metrics validation
  if (metrics.speakerMetrics) {
    const { agentTalkPercentage, interruptionCount } = metrics.speakerMetrics;

    if (typeof agentTalkPercentage !== 'number' || isNaN(agentTalkPercentage)) {
      errors.push('agentTalkPercentage must be a valid number');
    } else {
      if (agentTalkPercentage < VALIDATION_RULES.agentTalkPercentage.min ||
          agentTalkPercentage > VALIDATION_RULES.agentTalkPercentage.max) {
        errors.push(`agentTalkPercentage must be between 0 and 100`);
      }
      
      // Warn about extreme talk percentages
      if (agentTalkPercentage < 10) {
        warnings.push('Agent talk percentage is very low (<10%)');
      } else if (agentTalkPercentage > 90) {
        warnings.push('Agent talk percentage is very high (>90%)');
      }
    }

    if (typeof interruptionCount !== 'number' || isNaN(interruptionCount)) {
      errors.push('interruptionCount must be a valid number');
    } else {
      if (interruptionCount < VALIDATION_RULES.interruptionCount.min) {
        errors.push('interruptionCount cannot be negative');
      }
      if (interruptionCount > VALIDATION_RULES.interruptionCount.max) {
        warnings.push(`interruptionCount ${interruptionCount} is unusually high`);
      }
    }
  }

  // Issues validation
  if (metrics.issues !== undefined) {
    if (!Array.isArray(metrics.issues)) {
      errors.push('issues must be an array');
    } else if (metrics.issues.length > 50) {
      warnings.push('Unusually high number of issues detected');
    }
  }

  // Sanitize metrics if valid
  let sanitizedMetrics: AgentMetricsInput | undefined;
  if (errors.length === 0) {
    sanitizedMetrics = sanitizeMetrics(metrics);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedMetrics
  };
}

/**
 * Sanitize and normalize metrics
 */
function sanitizeMetrics(metrics: AgentMetricsInput): AgentMetricsInput {
  const sanitized = { ...metrics };

  // Normalize sentiment to uppercase
  if (sanitized.sentiment) {
    sanitized.sentiment = sanitized.sentiment.toUpperCase();
  }

  // Cap hold time to duration if exceeded
  if (sanitized.holdTime && sanitized.holdTime > sanitized.duration) {
    sanitized.holdTime = sanitized.duration;
  }

  // Adjust talk time and hold time if they exceed duration
  if (sanitized.talkTime !== undefined && sanitized.holdTime !== undefined) {
    const total = sanitized.talkTime + sanitized.holdTime;
    if (total > sanitized.duration) {
      // Proportionally adjust both
      const ratio = sanitized.duration / total;
      sanitized.talkTime = Math.round(sanitized.talkTime * ratio);
      sanitized.holdTime = Math.round(sanitized.holdTime * ratio);
    }
  }

  // Default talkTime to duration if not provided
  if (sanitized.talkTime === undefined) {
    sanitized.talkTime = sanitized.duration - (sanitized.holdTime || 0);
  }

  // Ensure non-negative values
  if (sanitized.talkTime < 0) sanitized.talkTime = 0;
  if (sanitized.holdTime !== undefined && sanitized.holdTime < 0) sanitized.holdTime = 0;

  // Default boolean flags
  if (sanitized.transferred === undefined) sanitized.transferred = false;
  if (sanitized.escalated === undefined) sanitized.escalated = false;

  // Default issues to empty array
  if (sanitized.issues === undefined) sanitized.issues = [];

  return sanitized;
}

/**
 * Validate aggregated performance metrics before final storage
 */
export interface AggregatedMetricsInput {
  totalCalls: number;
  averageHandleTime: number;
  averageSentiment: number;
  sentimentScores: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  };
  transferRate: number;
  completionRate?: number;
}

export function validateAggregatedMetrics(metrics: AggregatedMetricsInput): MetricsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Total calls must be positive
  if (metrics.totalCalls < 0) {
    errors.push('totalCalls cannot be negative');
  }

  // Average handle time validation
  if (metrics.averageHandleTime < 0) {
    errors.push('averageHandleTime cannot be negative');
  } else if (metrics.averageHandleTime > 14400) {
    errors.push('averageHandleTime cannot exceed 4 hours');
  }

  // Reasonable AHT range
  if (metrics.averageHandleTime > 0 && metrics.totalCalls > 0) {
    if (metrics.averageHandleTime < 30) {
      warnings.push('averageHandleTime is very low (<30s), may indicate data quality issue');
    } else if (metrics.averageHandleTime > 3600) {
      warnings.push('averageHandleTime is very high (>1h), may indicate data quality issue');
    }
  }

  // Average sentiment validation
  if (metrics.averageSentiment < 0 || metrics.averageSentiment > 100) {
    errors.push('averageSentiment must be between 0 and 100');
  }

  // Sentiment scores validation
  const { positive, neutral, negative, mixed } = metrics.sentimentScores;
  if (positive < 0 || neutral < 0 || negative < 0 || mixed < 0) {
    errors.push('sentiment scores cannot be negative');
  }

  const totalSentiment = positive + neutral + negative + mixed;
  if (totalSentiment > metrics.totalCalls) {
    errors.push('total sentiment scores cannot exceed total calls');
  }

  // Transfer rate validation
  if (metrics.transferRate < 0 || metrics.transferRate > 100) {
    errors.push('transferRate must be between 0 and 100');
  }

  // High transfer rate warning
  if (metrics.transferRate > 50) {
    warnings.push('transferRate is very high (>50%), may indicate training issue');
  }

  // Completion rate validation
  if (metrics.completionRate !== undefined) {
    if (metrics.completionRate < 0 || metrics.completionRate > 100) {
      errors.push('completionRate must be between 0 and 100');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedMetrics: metrics
  };
}

/**
 * Validate that call counts are not decreasing
 */
export function validateCallCountIntegrity(
  previousCount: number,
  newCount: number,
  callId: string
): MetricsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (newCount < previousCount) {
    errors.push(`Call count decreased from ${previousCount} to ${newCount} for call ${callId} - data integrity violation`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

