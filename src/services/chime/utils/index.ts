/**
 * Chime Stack Utility Modules Index
 * 
 * Exports all utility modules for the Chime call center stack.
 * Import from this file for convenient access to all features.
 * 
 * @example
 * import { broadcastRingToAllAgents, claimBroadcastCall } from './utils';
 * import { publishMetric, MetricName } from './utils';
 * 
 * @module utils
 */

// Broadcast Ring Strategy
export {
    broadcastRingToAllAgents,
    claimBroadcastCall,
    handleBroadcastTimeout,
    getRingStrategy,
    isBroadcastEnabled,
    type BroadcastConfig,
    type BroadcastResult,
    type ClaimResult,
} from './broadcast-assignment';

// CloudWatch Metrics
export {
    publishMetric,
    publishMetrics,
    flushMetrics,
    publishQueueMetrics,
    publishAgentMetrics,
    publishCallMetrics,
    publishServiceLevel,
    publishQualityMetrics,
    publishRoutingMetrics,
    createLatencyTimer,
    shutdownMetrics,
    MetricName,
} from './cloudwatch-metrics';

// Overflow Routing
export {
    shouldTriggerOverflow,
    getOverflowClinics,
    fetchOverflowAgents,
    attemptOverflowRouting,
    isOverflowAgent,
    getOverflowStats,
    type OverflowConfig,
    type OverflowGroup,
    type OverflowResult,
} from './overflow-routing';

// Smart Retry & Circuit Breaker
export {
    withRetry,
    withCircuitBreaker,
    withRetryAndCircuitBreaker,
    calculateRetryDelay,
    classifyError,
    isRetryable,
    isCircuitOpen,
    recordFailure,
    recordSuccess,
    getCircuitBreakerStatus,
    resetCircuitBreaker,
    ErrorType,
    type RetryConfig,
    type CircuitBreakerConfig,
    type RetryableError,
} from './smart-retry';

// Enhanced Agent Selection
export {
    calculateTimeOfDayBonus,
    calculatePerformanceBonus,
    calculateFairnessAdjustment,
    calculateCallerMatchBonus,
    fetchAgentPerformanceData,
    scoreAgentEnhanced,
    rankAgentsEnhanced,
    getFairDistributionStats,
    type EnhancedConfig,
    type AgentPerformanceData,
    type EnhancedAgentScore,
} from './enhanced-agent-selection';

// Supervisor Tools
export {
    SupervisionMode,
    getMonitorableCalls,
    startSupervision,
    changeSupervisionMode,
    endSupervision,
    sendWhisperMessage,
    getWhisperMessages,
    markWhisperMessagesRead,
    getSupervisionHistory,
    type SupervisionSession,
    type SupervisionResult,
    type LiveCallInfo,
} from './supervisor-tools';

// Sentiment Analysis
export {
    analyzeSentiment,
    analyzeSentimentBatch,
    processTranscriptionSegment,
    generateCallSentimentSummary,
    publishSentimentMetrics,
    cleanupSentimentCache,
    type SentimentResult,
    type CallSentimentSummary,
    type SentimentConfig,
} from './sentiment-analyzer';

// Call Summarization
export {
    summarizeCall,
    saveCallSummary,
    generateQuickSummary,
    extractCallbackInfo,
    type CallSummary,
    type SummaryConfig,
} from './call-summarizer';

// Quality Scoring
export {
    calculateAudioQualityScore,
    calculateAgentPerformanceScore,
    calculateCustomerExperienceScore,
    calculateComplianceScore,
    calculateQualityMetrics,
    saveQualityMetrics,
    getQualityTrends,
    shouldAlertOnQuality,
    type QualityMetrics,
    type QualityConfig,
} from './quality-scoring';

// PII Redaction
export {
    redactPII,
    redactWithComprehend,
    redactWithRegex,
    redactTranscript,
    containsPII,
    redactObject,
    maskPhoneNumber,
    maskEmail,
    getSafeLogData,
    type RedactionConfig,
    type RedactionResult,
} from './pii-redactor';

// Audit Logging
export {
    AuditEventType,
    AuditSeverity,
    createAuditEvent,
    logAuditEvent,
    audit,
    auditCallEvent,
    auditPiiAccess,
    getAuditEvents,
    getCallAuditTrail,
    generateComplianceReport,
    type AuditEvent,
    type AuditConfig,
} from './call-audit-logger';

// Performance Tracking
export {
    startTrace,
    startSpan,
    endSpan,
    endTrace,
    timeOperation,
    createTimer,
    recordLatency,
    getActiveTraceCount,
    cleanupStaleTraces,
    formatTrace,
    PERFORMANCE_THRESHOLDS,
    type PerformanceSpan,
    type PerformanceTrace,
} from './performance-tracker';
