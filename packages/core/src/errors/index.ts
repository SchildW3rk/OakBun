export class OakBunError extends Error {
  constructor(
    message:            string,
    readonly status:    number,
    readonly code:      string,
  ) {
    super(message)
    this.name = 'OakBunError'
  }
}

export class BadRequestError extends OakBunError {
  constructor(message = 'Bad Request', code = 'BAD_REQUEST') {
    super(message, 400, code)
    this.name = 'BadRequestError'
  }
}

export class UnauthorizedError extends OakBunError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(message, 401, code)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends OakBunError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, 403, code)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends OakBunError {
  constructor(message = 'Not Found', code = 'NOT_FOUND') {
    super(message, 404, code)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends OakBunError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(message, 409, code)
    this.name = 'ConflictError'
  }
}

export class UnprocessableError extends OakBunError {
  constructor(message = 'Unprocessable Entity', code = 'UNPROCESSABLE') {
    super(message, 422, code)
    this.name = 'UnprocessableError'
  }
}

export class TooManyRequestsError extends OakBunError {
  constructor(message = 'Too Many Requests', code = 'TOO_MANY_REQUESTS') {
    super(message, 429, code)
    this.name = 'TooManyRequestsError'
  }
}

export class InternalError extends OakBunError {
  constructor(message = 'Internal Server Error', code = 'INTERNAL_ERROR') {
    super(message, 500, code)
    this.name = 'InternalError'
  }
}
