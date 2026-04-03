// Re-export from the central errors module so resource-level imports still work.
// NotFoundError and ConflictError are now VelnError subclasses with status + code.
export { NotFoundError, ConflictError } from '../errors/index'
