const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000/api'

/**
 * request
 * Shared fetch wrapper. Errors now carry the HTTP status code (when
 * available) so callers can tell "your token is actually invalid" (401)
 * apart from "the server didn't respond" (network error, cold-start
 * timeout, 500, etc.) -- these need very different handling. Treating
 * every failure as "log the user out" was the bug: a slow/sleeping
 * Render free-tier backend would force a valid session to log out.
 */
async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (networkErr) {
    // fetch() itself threw -- no response at all (offline, CORS block,
    // DNS failure, etc.). No status code available; NOT an auth failure.
    const err = new Error('Could not reach the server. Check your connection and try again.')
    err.status = null
    throw err
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.message || 'Something went wrong. Please try again.')
    err.status = res.status
    throw err
  }
  return data
}

export const registerUser = (payload) => request('/auth/register', { method: 'POST', body: payload })
export const loginUser = (payload) => request('/auth/login', { method: 'POST', body: payload })
export const getCurrentUser = (token) => request('/auth/me', { token })

export const fetchHistory = (token) => request('/history', { token })
export const saveHistoryEntry = (token, payload) => request('/history', { method: 'POST', body: payload, token })
export const deleteHistoryEntry = (token, id) => request(`/history/${id}`, { method: 'DELETE', token })

export const getPreferences = (token) => request('/preferences', { token })
export const updatePreferences = (token, payload) => request('/preferences', { method: 'PUT', body: payload, token })
