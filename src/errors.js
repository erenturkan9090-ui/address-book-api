'use strict';

/** An error that maps directly to an HTTP response. */
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static notFound(message) {
    return new ApiError(404, 'NOT_FOUND', message);
  }
}

/** Shape every error response takes, so clients parse one format. */
function errorBody(status, code, message, details) {
  const error = { status, code, message };
  if (details && details.length > 0) error.details = details;
  return { error };
}

module.exports = { ApiError, errorBody };
