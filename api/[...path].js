const http   = require('http')
const { URL } = require('url')

const BACKEND_HOST = '13.232.27.217'
const BACKEND_PORT = 8080

module.exports = async function handler(req, res) {
  const parsed  = new URL(req.url, `http://${BACKEND_HOST}:${BACKEND_PORT}`)
  const pathname = parsed.pathname.replace(/^\/api/, '') || '/'

  // Read request body
  let body = ''
  if (!['GET', 'HEAD'].includes(req.method)) {
    await new Promise((resolve) => {
      req.on('data', chunk => { body += chunk })
      req.on('end', resolve)
    })
  }

  // Forward to EC2 using Node's built-in http module (no fetch, no HTTPS restriction)
  const options = {
    hostname: BACKEND_HOST,
    port:     BACKEND_PORT,
    path:     pathname + (parsed.search || ''),
    method:   req.method,
    headers:  { 'Content-Type': 'application/json' },
  }

  const proxy = http.request(options, (backendRes) => {
    let data = ''
    backendRes.on('data', chunk => { data += chunk })
    backendRes.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.status(backendRes.statusCode).send(data)
    })
  })

  proxy.on('error', (err) => {
    res.status(502).json({ detail: `Proxy error: ${err.message}` })
  })

  if (body) proxy.write(body)
  proxy.end()
}
