/**
 * Vercel Serverless Proxy
 *
 * All /api/* requests are handled here server-side.
 * Vercel (HTTPS) → this function → EC2 backend (HTTP)
 * The browser never touches the HTTP URL — no mixed content.
 */

const BACKEND = 'http://13.232.27.217:8080'

export default async function handler(req, res) {
  // req.query.path is an array from [...path] catch-all
  // e.g. /api/filter → ['filter'],  /api/select_match → ['select_match']
  const segments  = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean)
  const pathname  = '/' + segments.join('/')

  // Re-attach any query params that aren't the path segments
  const params = { ...req.query }
  delete params.path
  const qs = new URLSearchParams(params).toString()

  const targetUrl = `${BACKEND}${pathname}${qs ? '?' + qs : ''}`

  const fetchOptions = {
    method:  req.method,
    headers: { 'Content-Type': 'application/json' },
    // do NOT follow redirects — surface them as errors instead
    redirect: 'error',
  }

  if (!['GET', 'HEAD'].includes(req.method) && req.body) {
    fetchOptions.body = JSON.stringify(req.body)
  }

  try {
    const backendRes = await fetch(targetUrl, fetchOptions)
    const text = await backendRes.text()

    // Try to parse as JSON; fall back to plain text
    let data
    try { data = JSON.parse(text) } catch { data = text }

    res.status(backendRes.status).json(data)
  } catch (err) {
    console.error(`Proxy error → ${targetUrl}:`, err.message)
    res.status(502).json({ detail: `Proxy error: ${err.message}` })
  }
}
