import { useState } from 'react'

// Credentials are compared against a pre-computed SHA-256 digest so the
// plain-text values never appear in the final JS bundle.
const CRED_HASH = '2c99137eb87a22852b69819071a22fa1fcc3b01e0df62ecc1f2a604f9e521cf3'

async function _sha256(str) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(str)
  )
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function checkCredentials(username, password) {
  const hash = await _sha256(`${username}:${password}`)
  return hash === CRED_HASH
}

const SESSION_AUTH_KEY = 'meta_enr_auth'

export function isAuthenticated() {
  try {
    const val = sessionStorage.getItem(SESSION_AUTH_KEY)
    return val === 'granted'
  } catch { return false }
}

export function logout() {
  try { sessionStorage.removeItem(SESSION_AUTH_KEY) } catch {}
}

export default function Login({ onSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const ok = await checkCredentials(username.trim(), password)
      if (ok) {
        sessionStorage.setItem(SESSION_AUTH_KEY, 'granted')
        onSuccess()
      } else {
        setError('Invalid username or password.')
        setPassword('')
      }
    } catch {
      setError('Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Logo / title */}
        <div style={styles.logoRow}>
          <span style={styles.logo}>Meta Enrichment</span>
          <span style={styles.badge}>AI</span>
        </div>
        <p style={styles.subtitle}>Sign in to continue</p>

        <form onSubmit={handleSubmit} style={styles.form} autoComplete="off">
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Username</label>
            <input
              style={styles.input}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter username"
              autoFocus
              autoComplete="username"
              spellCheck={false}
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Password</label>
            <div style={styles.pwWrap}>
              <input
                style={{ ...styles.input, paddingRight: 44 }}
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
              />
              <button
                type="button"
                style={styles.eyeBtn}
                onClick={() => setShowPw(v => !v)}
                tabIndex={-1}
              >
                {showPw ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button
            type="submit"
            style={{ ...styles.submitBtn, opacity: loading ? 0.7 : 1 }}
            disabled={loading || !username || !password}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    padding: 16,
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '40px 36px',
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 8px 48px #0009',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  logo: {
    fontSize: '1.4rem',
    fontWeight: 800,
    background: 'linear-gradient(135deg, #3961a1, #455bb2)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    letterSpacing: '-0.5px',
  },
  badge: {
    fontSize: '0.7rem',
    fontWeight: 800,
    background: 'linear-gradient(90deg, #a78bfa, #60a5fa)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    border: '1px solid #a78bfa55',
    borderRadius: 6,
    padding: '2px 7px',
    letterSpacing: '0.08em',
  },
  subtitle: {
    fontSize: '0.85rem',
    color: 'var(--muted)',
    marginBottom: 20,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    fontSize: '0.9rem',
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box',
  },
  pwWrap: {
    position: 'relative',
  },
  eyeBtn: {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1rem',
    padding: 0,
    lineHeight: 1,
  },
  error: {
    background: '#ff5c7a22',
    border: '1px solid #ff5c7a55',
    borderRadius: 8,
    padding: '9px 14px',
    color: '#ff5c7a',
    fontSize: '0.82rem',
  },
  submitBtn: {
    marginTop: 4,
    padding: '11px',
    background: 'linear-gradient(135deg, #3961a1, #455bb2)',
    border: 'none',
    borderRadius: 9,
    color: '#fff',
    fontWeight: 700,
    fontSize: '0.95rem',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
    letterSpacing: '0.02em',
  },
}
