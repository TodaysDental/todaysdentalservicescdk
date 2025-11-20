/**
 * FIX #53: Sanitized Error Responses
 * 
 * Prevents internal error details from being exposed to clients.
 * Provides user-friendly error messages with retry guidance.
 */

export interface ClientError {
  message: string;
  code: string;
  requestId?: string;
  retryable?: boolean;
}

/**
 * Build a client-safe error response from an internal error
 */
export function buildClientError(
  error: Error,
  operation: string,
  requestId?: string
): ClientError {
  // Map internal errors to client-friendly messages
  const errorMap: Record<string, ClientError> = {
    'ConditionalCheckFailedException': {
      message: 'The operation could not be completed due to a conflict. Please try again.',
      code: 'CONFLICT',
      retryable: true
    },
    'ProvisionedThroughputExceededException': {
      message: 'The service is experiencing high load. Please try again in a moment.',
      code: 'SERVICE_BUSY',
      retryable: true
    },
    'ResourceNotFoundException': {
      message: 'The requested resource was not found.',
      code: 'NOT_FOUND',
      retryable: false
    },
    'ThrottlingException': {
      message: 'Too many requests. Please wait a moment and try again.',
      code: 'RATE_LIMIT',
      retryable: true
    },
    'ValidationException': {
      message: 'The request contains invalid data.',
      code: 'INVALID_INPUT',
      retryable: false
    },
    'ServiceUnavailableException': {
      message: 'The service is temporarily unavailable. Please try again.',
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    },
    'InternalServerError': {
      message: 'An internal error occurred. Please try again.',
      code: 'INTERNAL_ERROR',
      retryable: true
    }
  };

  // Check if we have a mapped error
  const mapped = errorMap[error.name];
  if (mapped) {
    return { ...mapped, requestId };
  }

  // Generic error (hide details)
  return {
    message: `An error occurred while processing your ${operation} request.`,
    code: 'INTERNAL_ERROR',
    requestId,
    retryable: false
  };
}

/**
 * Build a standardized error response for API Gateway
 */
export function buildErrorResponse(
  error: Error,
  operation: string,
  requestId: string,
  corsHeaders: Record<string, string>
): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const clientError = buildClientError(error, operation, requestId);
  
  // Determine status code
  let statusCode = 500;
  if (error.name === 'ConditionalCheckFailedException') statusCode = 409;
  else if (error.name === 'ResourceNotFoundException') statusCode = 404;
  else if (error.name === 'ValidationException') statusCode = 400;
  else if (error.name === 'ThrottlingException') statusCode = 429;
  else if (error.name === 'ServiceUnavailableException') statusCode = 503;

  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(clientError)
  };
}

/**
 * Sanitize error message to remove sensitive information
 */
export function sanitizeErrorMessage(message: string): string {
  // Remove patterns that might contain sensitive info
  return message
    .replace(/\b\d{10,}\b/g, '***') // Phone numbers
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '***@***') // Emails
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '***-***') // UUIDs (partial)
    .replace(/arn:aws:[^:]+:[^:]+:[^:]+:[^\/]+/g, 'arn:aws:***') // ARNs
    .substring(0, 500); // Limit length
}

