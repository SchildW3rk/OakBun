import type { ZodIssue } from 'zod'

export class OakBunClientError extends Error {
  constructor(
    readonly status:  number,
    readonly code:    string,
    message:          string,
    readonly issues?: ZodIssue[],
  ) {
    super(message)
    this.name = 'OakBunClientError'
  }
}
