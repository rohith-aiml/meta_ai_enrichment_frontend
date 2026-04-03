/**
 * Vercel Serverless Proxy
 *
 * Catches every request to /api/* and forwards it to the EC2 backend over HTTP.
 *
 * Flow:
 *   Browser  →  https://yourapp.vercel.app/api/filter    (HTTPS — browser safe)
 *   Proxy    →  http://13.232.27.217:8080/filter          (HTTP  — server-to-server, no restriction)
 */

const BACKEND = 'http://13.232.27.217:8080'

export default async function handler(req, res) {
  // Build the target URL:  /api/filter?x=1  →  http://13.232.27.217:8080/filter?x=1
  const path = '/' + (req.query.path || []).join('/')
  const qs   = new URLSearchParams(
    Object.entries(req.query).filter(([k]) => k !== 'path')
  ).toString()
  const targetUrl = `${BACKEND}${path}${qs ? '?' + qs : ''}`

  // Forward method + body + relevant headers
  const fetchOptions = {
    method:  req.method,
    headers: {
      'Content-Type': req.headers['content-type'] || 'application/json',
    },
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    fetchOptions.body = JSON.stringify(req.body)
  }

  try {
    const backendRes = await fetch(targetUrl, fetchOptions)
    const data       = await backendRes.json()

    res.status(backendRes.status).json(data)
  } catch (err) {
    res.status(502).json({ detail: `Proxy error: ${err.message}` })
  }
}
