import { SignJWT, jwtVerify, importSPKI, importPKCS8, errors as joseErrors } from 'jose'
import type { CryptoKey, KeyObject } from 'jose'
import type { JwtPayload, JwtConfig } from './types'

type JoseKey = CryptoKey | KeyObject
import { WeakSecretError, TokenExpiredError, InvalidTokenError } from './errors'

// ── Key helpers ────────────────────────────────────────────────────────────────

export function encodeHmacSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function importVerifyKey(config: JwtConfig): Promise<JoseKey | Uint8Array> {
  if (config.algorithm === 'HS256') {
    return encodeHmacSecret(config.secret)
  }
  if (!config.publicKey) throw new InvalidTokenError('RS256 requires publicKey for verification')
  return importSPKI(config.publicKey, 'RS256')
}

// ── jose error → @veln/jwt error mapping ──────────────────────────────────────

function mapJoseError(err: unknown): never {
  if (err instanceof joseErrors.JWTExpired) {
    throw new TokenExpiredError()
  }
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    if (err.claim === 'nbf') throw new InvalidTokenError('Token not yet valid (nbf)')
    throw new InvalidTokenError(`Claim validation failed: ${err.claim}`)
  }
  if (
    err instanceof joseErrors.JWSSignatureVerificationFailed ||
    err instanceof joseErrors.JWSInvalid ||
    err instanceof joseErrors.JWTInvalid ||
    err instanceof joseErrors.JOSEAlgNotAllowed ||
    err instanceof joseErrors.JOSENotSupported
  ) {
    throw new InvalidTokenError()
  }
  throw err
}

// ── signJwt ────────────────────────────────────────────────────────────────────

/**
 * signJwt — creates a signed JWT.
 *
 * HS256 (symmetric):
 *   const token = await signJwt({ sub: '42', exp: now + 3600 }, 'my-secret')
 *
 * RS256 (asymmetric) — requires privateKey in the config:
 *   const token = await signJwt({ sub: '42' }, { algorithm: 'RS256', privateKey: '...' })
 *
 * Legacy shorthand: passing a plain string is equivalent to { algorithm: 'HS256', secret }.
 */
export async function signJwt(payload: JwtPayload, config: string | JwtConfig): Promise<string> {
  const resolved: JwtConfig = typeof config === 'string'
    ? { algorithm: 'HS256', secret: config }
    : config

  if (resolved.algorithm === 'HS256' && resolved.secret.length < 32) {
    throw new WeakSecretError()
  }

  // Spread all custom claims; handle standard claims explicitly
  const { exp, nbf, aud, iss, jti, iat: _iat, ...customClaims } = payload

  const builder = new SignJWT(customClaims)
    .setProtectedHeader({ alg: resolved.algorithm })
    .setIssuedAt()

  if (exp !== undefined) builder.setExpirationTime(exp)
  if (nbf !== undefined) builder.setNotBefore(nbf)
  if (aud !== undefined) builder.setAudience(aud)
  if (iss !== undefined) builder.setIssuer(iss)
  if (jti !== undefined) builder.setJti(jti)

  if (resolved.algorithm === 'HS256') {
    return builder.sign(encodeHmacSecret(resolved.secret))
  }

  // RS256
  if (!resolved.privateKey) throw new Error('signJwt: RS256 requires privateKey in config')
  const privateKey = await importPKCS8(resolved.privateKey, 'RS256')
  return builder.sign(privateKey)
}

// ── verifyToken (accepts pre-imported cached key) ──────────────────────────────

export async function verifyToken(
  token: string,
  config: JwtConfig,
  cachedKey: JoseKey | Uint8Array | undefined,
  clockSkewSeconds: number,
  issuer?: string,
  audience?: string,
): Promise<JwtPayload> {
  const clockTolerance = `${clockSkewSeconds}s`

  try {
    const key: JoseKey | Uint8Array = cachedKey ?? await importVerifyKey(config)

    const { payload } = await jwtVerify(token, key, {
      algorithms:     [config.algorithm],
      clockTolerance,
      issuer,
      audience,
    })

    return payload as JwtPayload
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof InvalidTokenError) throw err
    mapJoseError(err)
  }
}
