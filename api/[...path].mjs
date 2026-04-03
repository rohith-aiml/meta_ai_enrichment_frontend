/**
 * Vercel Edge Function Proxy
 * Runs on Vercel's edge network — no Node.js runtime issues.
 * Browser (HTTPS) → this edge fn → EC2 backend (HTTP, server-side)
 */

export const config = { runtime: 'edge' }

const BACKEND = 'http://13.232.27.217:8080'

export default async function handler(req) {
  const url    = new URL(req.url)
  // Strip the leading /api from the path
  const path   = url.pathname.replace(/^\/api/, '') || '/'
  const target = `${BACKEND}${path}${url.search}`

  const fetchOptions = {
    method:   req.method,
    headers:  { 'Content-Type': 'application/json' },
    redirect: 'manual',   // never follow redirects
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    fetchOptions.body = await req.text()
  }

  try {
    const res  = await fetch(target, fetchOptions)
    const body = await res.text()

    return new Response(body, {
      status:  res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ detail: `Proxy error: ${err.message}` }), {
      status:  502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
