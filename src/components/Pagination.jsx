// Simple prev / next / numbered pagination component
export default function Pagination({ page, totalPages, onPageChange }) {
  if (!totalPages || totalPages <= 1) return null

  // Show at most 7 page buttons around the current page
  const pages = []
  const delta = 2
  const start = Math.max(1, page - delta)
  const end   = Math.min(totalPages, page + delta)

  if (start > 1) {
    pages.push(1)
    if (start > 2) pages.push('...')
  }
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push('...')
    pages.push(totalPages)
  }

  return (
    <div className="pagination">
      <button
        className="page-btn"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        title="Previous page"
      >‹</button>

      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dot-${i}`} style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>…</span>
        ) : (
          <button
            key={p}
            className={`page-btn ${p === page ? 'active' : ''}`}
            onClick={() => onPageChange(p)}
          >{p}</button>
        )
      )}

      <button
        className="page-btn"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        title="Next page"
      >›</button>
    </div>
  )
}
