/**
 * API client.
 *
 * `credentials: 'include'` on every call so the httpOnly refresh cookie travels
 * with it. The access token lives in memory only — never localStorage, which an
 * XSS can read. docs/11 §2.2
 */
export interface ApiError {
  code: string
  title: string
  status: number
}

let accessToken: string | null = null

export const setAccessToken = (token: string | null): void => {
  accessToken = token
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

/**
 * The type parameter lets a caller state the shape it expects at the call site
 * rather than casting the result afterwards.
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: 'include',
      // Built explicitly rather than spread: `HeadersInit` may be an array or a
      // Headers instance, and spreading either into an object yields indices.
      headers: buildHeaders(init.headers, init.body !== undefined && init.body !== null),
    })

    const body: unknown = await response.json().catch(() => null)

    if (!response.ok) {
      const problem = (body ?? {}) as Partial<ApiError>
      return {
        ok: false,
        error: {
          code: problem.code ?? 'UNKNOWN',
          title: problem.title ?? 'Request failed',
          status: response.status,
        },
      }
    }
    return { ok: true, data: body as T }
  } catch {
    // A network failure is a distinct, translatable condition — not the same
    // as the server rejecting the request.
    return { ok: false, error: { code: 'NETWORK', title: 'Network error', status: 0 } }
  }
}

function buildHeaders(extra: HeadersInit | undefined, hasBody: boolean): Record<string, string> {
  // Content-Type only when a body exists: Fastify (correctly) rejects an EMPTY
  // json body with FST_ERR_CTP_EMPTY_JSON_BODY, so a body-less POST /start with
  // the header set 500s. Found in the browser — inject() never set the header,
  // so the e2e suite could not see it.
  const headers: Record<string, string> = hasBody ? { 'Content-Type': 'application/json' } : {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  if (extra instanceof Headers) {
    extra.forEach((value, key) => (headers[key] = value))
  } else if (Array.isArray(extra)) {
    for (const [key, value] of extra) if (key) headers[key] = value
  } else if (extra) {
    Object.assign(headers, extra)
  }
  return headers
}
