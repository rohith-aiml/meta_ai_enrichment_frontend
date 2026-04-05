import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Login, { isAuthenticated } from './Login'
import './index.css'

function Root() {
  const [authed, setAuthed] = useState(isAuthenticated)
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
