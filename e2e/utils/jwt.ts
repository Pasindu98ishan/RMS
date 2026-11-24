/** Decodes (does not verify) a JWT payload — used to check token lifetimes (P1-AUTH-02). */
export interface JwtClaims {
  exp?: number;
  iat?: number;
  sub?: string;
  [claim: string]: unknown;
}

export function decodeJwt(token: string): JwtClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Not a JWT (expected 3 dot-separated parts)');
  const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json) as JwtClaims;
}

/** Lifetime in seconds (exp − iat), or undefined when either claim is missing. */
export function lifetimeSeconds(token: string): number | undefined {
  const { exp, iat } = decodeJwt(token);
  return typeof exp === 'number' && typeof iat === 'number' ? exp - iat : undefined;
}

/** Flips one character of the signature so the token must be rejected. */
export function tamperSignature(token: string): string {
  const [h, p, s] = token.split('.');
  const last = s.slice(-1) === 'A' ? 'B' : 'A';
  return `${h}.${p}.${s.slice(0, -1)}${last}`;
}
