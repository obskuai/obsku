/**
 * HTTP status codes used throughout the agent-server package
 */
export const HTTP_STATUS = {
  /** 200 OK - Successful request */
  OK: 200,
  /** 202 Accepted - Request has been accepted for processing */
  ACCEPTED: 202,
  /** 400 Bad Request - Invalid request syntax or parameters */
  BAD_REQUEST: 400,
  /** 401 Unauthorized - Authentication required */
  UNAUTHORIZED: 401,
  /** 404 Not Found - Requested resource does not exist */
  NOT_FOUND: 404,
  /** 413 Payload Too Large - Request body exceeds size limit */
  PAYLOAD_TOO_LARGE: 413,
  /** 500 Internal Server Error - Server encountered an unexpected condition */
  INTERNAL_SERVER_ERROR: 500,
  /** 503 Service Unavailable - Provider/network temporarily unavailable */
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * JSON-RPC protocol version
 */
export const JSONRPC_VERSION = "2.0" as const;

/**
 * Default ports for each protocol
 */
export const DEFAULT_PORT = {
  /** AgentCore protocol (8080) */
  agentCore: 8080,
  /** A2A protocol (9000) */
  a2a: 9000,
} as const;

/**
 * SSE response Content-Type
 */
export const SSE_CONTENT_TYPE = "text/event-stream" as const;

/**
 * SSE Cache-Control header value (disable caching)
 */
export const SSE_CACHE_CONTROL = "no-cache" as const;

/**
 * SSE Connection header value (keep connection alive)
 */
export const SSE_CONNECTION = "keep-alive" as const;
