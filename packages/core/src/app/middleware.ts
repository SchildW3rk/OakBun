import type { Logger, BaseOptions, OnRequestFn, OnResponseFn } from './types'
import { createMinimalLogger } from './logger'

// ── MiddlewareDef — sealed result of MiddlewareBuilder.build() ────────────────

export interface MiddlewareDef {
  readonly _name:       string
  readonly _onRequest?:  OnRequestFn
  readonly _onResponse?: OnResponseFn
  readonly _logger:     Logger
}

// ── MiddlewareBuilder ─────────────────────────────────────────────────────────

export class MiddlewareBuilder {
  private _options:     BaseOptions  = {}
  private _onRequestFn?:  OnRequestFn
  private _onResponseFn?: OnResponseFn

  constructor(private readonly _name: string) {}

  options(opts: BaseOptions): this {
    this._options = opts
    return this
  }

  onRequest(fn: OnRequestFn): this {
    this._onRequestFn = fn
    return this
  }

  onResponse(fn: OnResponseFn): this {
    this._onResponseFn = fn
    return this
  }

  build(): MiddlewareDef {
    const logger = createMinimalLogger(`middleware:${this._name}`, this._options.log)
    return {
      _name:       this._name,
      _onRequest:  this._onRequestFn,
      _onResponse: this._onResponseFn,
      _logger:     logger,
    }
  }
}

// ── defineMiddleware — entry point ────────────────────────────────────────────

export function defineMiddleware(name: string): MiddlewareBuilder {
  return new MiddlewareBuilder(name)
}
