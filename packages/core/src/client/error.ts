import type { ZodIssue } from 'zod'

export class VelnClientError extends Error {
  constructor(
    readonly status:  number,
    readonly code:    string,
    message:          string,
    readonly issues?: ZodIssue[],
  ) {
    super(message)
    this.name = 'VelnClientError'
  }
}
