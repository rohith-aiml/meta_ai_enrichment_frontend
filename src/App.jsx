import { useState, useEffect, useRef } from 'react'
import FilterPanel from './components/FilterPanel'
import Pagination from './components/Pagination'
import { applyFilter, runEnrich, searchContents, advancedSearch, dubbedSearch, moderateImages } from './api/client'
import { logout } from './Login'
import {
  hasRootFolder, pickRootFolder, getFolderInfo,
  saveEnrichmentRow, removeEnrichmentRow,
  saveManualRow, removeManualRow,
  buildEnrichmentRow, buildManualRow,
} from './localCsv'

// ── Folder button with fixed-position tooltip (bypasses backdrop-filter clip) ──
function FolderButton({ folderReady, folderRoot, folderPath, onClick }) {
  const btnRef                = useRef(null)
  const [hovered, setHovered] = useState(false)
  const [tipPos,  setTipPos]  = useState({ top: 0, right: 0 })

  const handleMouseEnter = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setTipPos({ top: r.bottom + 8, right: window.innerWidth - r.right })
    }
    setHovered(true)
  }

  const label = folderReady && folderRoot
    ? `📁 ${folderRoot}`
    : '📁 Pick folder'

  return (
    <>
      <button
        ref={btnRef}
        className={`folder-btn${folderReady ? ' folder-btn--ready' : ''}`}
        style={{ marginLeft: 'auto' }}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
      >
        {label}
      </button>

      {hovered && (
        <div
          className="folder-tooltip"
          style={{ top: tipPos.top, right: tipPos.right }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {folderReady && folderPath ? (
            <>
              <div className="folder-tooltip-row">
                <span className="folder-tooltip-label">enrichment.csv</span>
                <span className="folder-tooltip-path">{folderPath} / enrichment.csv</span>
              </div>
              <div className="folder-tooltip-row">
                <span className="folder-tooltip-label">manual_enrichment.csv</span>
                <span className="folder-tooltip-path">{folderPath} / manual_enrichment.csv</span>
              </div>
              <div className="folder-tooltip-hint">Click to change folder</div>
            </>
          ) : (
            <span className="folder-tooltip-hint">Pick a folder to save CSV files locally</span>
          )}
        </div>
      )}
    </>
  )
}

// ── session persistence helpers ───────────────────────────────────────────────
const SESSION_KEY = 'meta_enr_session'

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') || {} }
  catch { return {} }
}

function saveSession(patch) {
  try {
    const prev = loadSession()
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, ...patch }))
  } catch {}
}

export default function App() {
  const _s = loadSession()

  // Filter results state
  const [filterResult, _setFilterResult]   = useState(_s.filterResult || null)
  const [filterLoading, setFilterLoading]  = useState(false)
  const [filterError, setFilterError]      = useState('')

  // Wrap setFilterResult to also persist
  const setFilterResult = (val) => {
    const next = typeof val === 'function' ? val(filterResult) : val
    _setFilterResult(next)
    saveSession({ filterResult: next })
  }

  // Enrich state
  const [enrichLoading, setEnrichLoading] = useState(false)
  const [enrichError, setEnrichError]     = useState('')

  // Keep the last filter body so we can re-use it for pagination clicks
  const [lastFilter, _setLastFilter]      = useState(_s.lastFilter || null)
  const setLastFilter = (val) => {
    const next = typeof val === 'function' ? val(lastFilter) : val
    _setLastFilter(next)
    saveSession({ lastFilter: next })
  }

  const [enrichActive, _setEnrichActive]  = useState(_s.enrichActive || false)
  const setEnrichActive = (val) => {
    _setEnrichActive(val)
    saveSession({ enrichActive: val })
  }

  // Cache enriched page results so navigating back doesn't re-fetch or re-enrich
  // { pageNum: filterResult } — cleared whenever a new filter is applied
  const pageResultsCacheRef = useRef(_s.pageResultsCache || {})

  // Persist per-card UI state (selections, search results) across page navigation
  // { contentid: { selectedMatchId, manualSaved, advResults, advSelectedId, dubbedResults, dubbedSelectedId } }
  const cardStateRef = useRef(_s.cardState || {})

  // Moderation results: { contentid → {tag, is_adult, label_detail, ...} }
  // Populated in the background after each filter/page load
  const [moderationMap, _setModerationMap] = useState(_s.moderationMap || {})
  const setModerationMap = (val) => {
    const next = typeof val === 'function' ? val(moderationMap) : val
    _setModerationMap(next)
    saveSession({ moderationMap: next })
  }

  const getCardState    = (cid) => cardStateRef.current[cid] || {}
  const updateCardState = (cid, patch) => {
    cardStateRef.current[cid] = { ...cardStateRef.current[cid], ...patch }
    saveSession({ cardState: cardStateRef.current })
  }

  // Local folder for CSV output
  const [folderReady, setFolderReady]       = useState(false)
  const [folderPath,  setFolderPath]        = useState('')  // full display path
  const [folderRoot,  setFolderRoot]        = useState('')  // just the root folder name

  const _refreshFolderState = async (projectId) => {
    const info = await getFolderInfo(projectId || null)
    setFolderReady(!!info)
    if (info) {
      setFolderRoot(info.rootName)
      setFolderPath(info.fullPath)
    }
  }
  useEffect(() => { _refreshFolderState(lastFilter?.project_id) }, [])

  const handlePickFolder = async () => {
    try {
      await pickRootFolder()
      const info = await getFolderInfo(lastFilter?.project_id || null)
      if (info) {
        setFolderReady(true)
        setFolderRoot(info.rootName)
        setFolderPath(info.fullPath)
      }
    } catch (e) {
      if (e.name !== 'AbortError') alert(e.message)
    }
  }

  // Search
  const [searchQuery, setSearchQuery]       = useState('')
  const [suggestions, setSuggestions]       = useState([])
  const [searchOpen, setSearchOpen]         = useState(false)
  const [highlightId, setHighlightId]       = useState(null)
  const searchTimerRef                      = useRef(null)

  // ── handlers ──────────────────────────────────────────────────────────────

  // Run moderation in the background; merges new results into existing map
  const runModeration = (contents) => {
    if (!contents?.length) return
    const items = contents
      .filter(c => c.imgurl && c.imgurl !== 'nan')
      .map(c => ({ contentid: c.contentid, imgurl: c.imgurl }))
    if (!items.length) return
    moderateImages(items)
      .then(results => setModerationMap(prev => ({ ...prev, ...results })))
      .catch(() => {/* silent — moderation is non-blocking */})
  }

  const handleApply = async (filterBody) => {
    setFilterLoading(true)
    setFilterError('')
    setFilterResult(null)
    setEnrichActive(false)
    setLastFilter(filterBody)
    pageResultsCacheRef.current = {}
    cardStateRef.current = {}
    setModerationMap({})
    saveSession({ pageResultsCache: {}, cardState: {} })
    if (folderReady) getFolderInfo(filterBody.project_id).then(info => { if (info) setFolderPath(info.fullPath) })
    try {
      const data = await applyFilter(filterBody)
      setFilterResult(data)
      runModeration(data.contents)
    } catch (err) {
      setFilterError(err?.response?.data?.detail || 'Failed to apply filters.')
    } finally {
      setFilterLoading(false)
    }
  }

  const handlePageChange = async (newPage) => {
    if (!lastFilter) return

    // If we've already fetched+enriched this page, restore it instantly
    if (pageResultsCacheRef.current[newPage]) {
      setFilterResult(pageResultsCacheRef.current[newPage])
      setLastFilter(prev => ({ ...prev, page: newPage }))
      return
    }

    const newFilter = { ...lastFilter, page: newPage }
    setLastFilter(newFilter)
    setFilterLoading(true)
    setFilterError('')
    try {
      const data = await applyFilter(newFilter)
      setFilterResult(data)
      pageResultsCacheRef.current[newPage] = data   // cache raw page
      saveSession({ pageResultsCache: pageResultsCacheRef.current })
      runModeration(data.contents)

      // Auto-enrich if already active (handleEnrich will overwrite cache with enriched data)
      if (enrichActive) {
        handleEnrich(newFilter, true)
      }
    } catch (err) {
      setFilterError(err?.response?.data?.detail || 'Failed to change page.')
    } finally {
      setFilterLoading(false)
    }
  }

  const handleEnrich = async (enrichBody, isAuto = false) => {
    setEnrichLoading(true)
    setEnrichError('')
    if (!isAuto) setEnrichActive(true)

    try {
      const data = await runEnrich(enrichBody)

      // Use _setFilterResult (raw React setter) so `prev` is always the true current
      // state — NOT the stale closure value captured when this function was created.
      // Without this, navigating to page 2 then enriching would apply results against
      // page 1's content IDs, find no matches, and silently show nothing.
      _setFilterResult(prev => {
        if (!prev || !data.results) return prev
        const enrichedContents = prev.contents.map(item => {
          const matchData = data.results.find(res => res.contentid === item.contentid)
          return matchData ? { ...item, matches: matchData.matches } : item
        })
        const updated = { ...prev, contents: enrichedContents }
        pageResultsCacheRef.current[prev.page] = updated
        saveSession({ filterResult: updated, pageResultsCache: pageResultsCacheRef.current })
        return updated
      })
    } catch (err) {
      setEnrichError(err?.response?.data?.detail || 'Enrichment failed.')
    } finally {
      setEnrichLoading(false)
    }
  }

  const handleSearchChange = (e) => {
    const q = e.target.value
    setSearchQuery(q)
    setSearchOpen(true)
    clearTimeout(searchTimerRef.current)
    if (!q.trim() || !lastFilter) { setSuggestions([]); return }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchContents(lastFilter, q.trim())
        setSuggestions(res)
      } catch { setSuggestions([]) }
    }, 280)
  }

  const handleSuggestionClick = async (s) => {
    setSearchOpen(false)
    setSearchQuery('')
    setSuggestions([])
    if (s.page !== filterResult?.page) {
      await handlePageChange(s.page)
    }
    setHighlightId(s.contentid)
    setTimeout(() => setHighlightId(null), 2000)
  }

  // ── scroll FAB visibility ──────────────────────────────────────────────────
  const [showFab, setShowFab] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY / (document.body.scrollHeight - window.innerHeight);
      setShowFab(scrolled >= 0.2);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── keyboard shortcuts for scroll ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && e.key === 't') { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      if (e.altKey && e.key === 'e') { e.preventDefault(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="header">
        <h1>Meta Enrichment</h1>
        <span className="ai-badge">AI</span>
        <FolderButton
          folderReady={folderReady}
          folderRoot={folderRoot}
          folderPath={folderPath}
          onClick={handlePickFolder}
        />
        <button
          style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--surface2)', color: 'var(--muted)', fontSize: '0.8rem',
            cursor: 'pointer',
          }}
          onClick={() => { logout(); window.location.reload() }}
        >
          Sign out
        </button>
      </header>

      <main className="main-content">
        {/* Filter panel */}
        <FilterPanel
          onApply={handleApply}
          onEnrich={handleEnrich}
          loading={filterLoading}
          enrichLoading={enrichLoading}
          filterCount={filterResult?.count ?? null}
        />

        {/* Errors */}
        {filterError  && <div className="error-banner">⚠️ {filterError}</div>}
        {enrichError  && <div className="error-banner">⚠️ {enrichError}</div>}

        {/* Loading spinner */}
        {filterLoading && (
          <div className="spinner-wrap">
            <div className="spinner" />
            <p>Loading contents…</p>
          </div>
        )}

        {/* Content list */}
        {!filterLoading && filterResult && filterResult.count === 0 && (
          <div className="empty-state">
            <div className="icon">📭</div>
            No contents matched your filters.
          </div>
        )}

        {!filterLoading && filterResult && filterResult.contents?.length > 0 && (
          <>
            <div className="results-header">
              <h3>Contents — Page {filterResult.page} / {filterResult.total_pages}</h3>
              <div className="search-wrap">
                <input
                  className="search-input"
                  placeholder="Search by ID or title…"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onFocus={() => suggestions.length > 0 && setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                />
                {searchOpen && suggestions.length > 0 && (
                  <ul className="search-suggestions">
                    {suggestions.map(s => (
                      <li key={s.contentid} className="search-suggestion-item" onMouseDown={() => handleSuggestionClick(s)}>
                        <span className="suggestion-name">{s.contentname}</span>
                        <span className="suggestion-meta">ID: {s.contentid} · p.{s.page}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {filterResult.contents.map((item) => (
              <ContentCard
                key={item.contentid}
                item={item}
                projectId={lastFilter.project_id}
                filterDate={lastFilter.date}
                enrichActive={enrichActive}
                highlight={highlightId === item.contentid}
                savedState={getCardState(item.contentid)}
                onStateChange={(patch) => updateCardState(item.contentid, patch)}
                moderation={moderationMap[item.contentid] || null}
                folderReady={folderReady}
                onNeedFolder={handlePickFolder}
              />
            ))}

            <Pagination
              page={filterResult.page}
              totalPages={filterResult.total_pages}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </main>

      {/* Enrich spinner while it runs */}
      {enrichLoading && (
        <div className="enrich-overlay" style={{ justifyContent: 'center' }}>
          <div className="spinner-wrap">
            <div className="spinner" />
            <p> Loading... this may take a moment on the first run.</p>
          </div>
        </div>
      )}

      {/* Scroll shortcut buttons */}
      <div className={`scroll-fab-group${showFab ? ' scroll-fab-group--visible' : ''}`}>
        <button
          className="scroll-fab"
          title="Scroll to top (Alt+T)"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >▲</button>
        <button
          className="scroll-fab"
          title="Scroll to end (Alt+E)"
          onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}
        >▼</button>
      </div>
    </div>
  )
}

// ── backend proxy helpers (keys stay server-side) ─────────────────────────────
const _BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://rohith696m-ai-metaenrichment-backend.hf.space'

function _backendHeaders() {
  const h = {}
  if (import.meta.env.VITE_HF_TOKEN) h['Authorization'] = `Bearer ${import.meta.env.VITE_HF_TOKEN}`
  return h
}

async function _backendGet(path) {
  const r = await fetch(`${_BACKEND}/${path}`, { headers: _backendHeaders() })
  if (!r.ok) return null
  return r.json()
}

// IMDB card — uses RapidAPI (imdb236) via backend /imdb/detail/{imdb_id}
async function _fetchImdbData(imdbId) {
  if (!imdbId) return null
  const data = await _backendGet(`imdb/detail/${encodeURIComponent(imdbId)}`).catch(() => null)
  if (!data?.result) return null
  const r = data.result
  return {
    genres:            Array.isArray(r.genres) ? r.genres : [],
    vote_average:      r.imdb_rating ? parseFloat(r.imdb_rating) : null,
    vote_count:        r.vote_count != null ? Number(r.vote_count) : null,
    release_year:      r.release_year || null,
    original_language: r.original_language || null,
    spoken_languages:  Array.isArray(r.spoken_languages) ? r.spoken_languages : [],
    poster_url:        r.poster_url || null,
    director:          r.director   || '',
    cast:              r.cast       || '',
    media_type:        'movie',
    tmdb_detail_id:    null,
  }
}

// TMDB details (genres + is_adult) — uses TMDB API via backend /tmdb/{type}/{id}/details
async function _fetchTDetails(tmdbId, mediaType = 'movie') {
  if (!tmdbId) return null
  const data = await _backendGet(`tmdb/${mediaType}/${tmdbId}/details`).catch(() => null)
  if (!data) return null
  return { genres: data.genres || [], is_adult: data.is_adult ?? false }
}

// TMDB keywords — uses TMDB API via backend /tmdb/{type}/{id}/keywords
async function _fetchTKeywords(tmdbId, mediaType = 'movie') {
  if (!tmdbId) return null
  const data = await _backendGet(`tmdb/${mediaType}/${tmdbId}/keywords`).catch(() => null)
  return data?.keywords || null
}

// Chip-style multi-value input
function ChipInput({ chips, onChange, placeholder }) {
  const [val, setVal] = useState('');
  const inputRef      = useRef(null);

  const addChip = (raw) => {
    const trimmed = raw.trim().replace(/,+$/, '').trim();
    if (!trimmed) return;
    // split on comma in case user pasted "Action, Drama"
    const parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    onChange(prev => {
      const next = [...prev];
      parts.forEach(p => { if (!next.includes(p)) next.push(p); });
      return next;
    });
    setVal('');
  };

  const handleKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && val.trim()) {
      e.preventDefault();
      addChip(val);
    }
    if (e.key === 'Backspace' && !val && chips.length > 0) {
      onChange(prev => prev.slice(0, -1));
    }
  };

  const handleBlur = () => { if (val.trim()) addChip(val); };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        gap: 4, padding: '5px 8px',
        border: '1px solid var(--border)', borderRadius: 6,
        background: 'var(--bg)', minHeight: 38, cursor: 'text',
      }}
    >
      {chips.map((chip, i) => (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '2px 6px', fontSize: '0.8rem', whiteSpace: 'nowrap',
        }}>
          {chip}
          <button type="button"
            onClick={(e) => { e.stopPropagation(); onChange(prev => prev.filter((_, j) => j !== i)); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1 }}
          >✕</button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={chips.length === 0 ? placeholder : ''}
        style={{
          border: 'none', outline: 'none', background: 'transparent',
          fontSize: '0.85rem', minWidth: 100, flex: 1, padding: '2px 0',
          color: 'inherit',
        }}
      />
    </div>
  );
}

// Modal for entering Manual Genre & Keywords before saving
function SelectModal({ match, onConfirm, onCancel, loading }) {
  const toChips = (str) => str ? str.split(',').map(s => s.trim()).filter(Boolean) : [];
  const [genreChips,   setGenreChips]   = useState(() => toChips(match.genres || ''));
  const [kwChips,      setKwChips]      = useState([]);

  const [imdbData,    setImdbData]    = useState(null);  // { genres, vote_count, vote_average, release_year, original_language, spoken_languages }
  const [tGenres,     setTGenres]     = useState(null);
  const [tIsAdult,    setTIsAdult]    = useState(null);
  const [tKeywords,   setTKeywords]   = useState(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [fetchDone,   setFetchDone]   = useState(false);

  // Editable save-to-CSV fields — pre-filled from match, overwritten by fetched IMDB data
  const [editRating, setEditRating] = useState(match.imdb_rating != null ? String(match.imdb_rating) : '');
  const [editYear,   setEditYear]   = useState(match.release_date ? match.release_date.slice(0, 4) : '');
  const [editLang,   setEditLang]   = useState(match.original_language || '');

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const imdbId = match.imdb_id;
    // For MatchCard: match.id is TMDB id (numeric); for AdvSearchCard: match.tmdb_id === 'not found'
    const tmdbId = (match.tmdb_id !== 'not found' && match.id && !String(match.id).startsWith('tt'))
      ? String(match.id) : null;

    if (!imdbId && !tmdbId) return;
    setMetaLoading(true);

    const p1 = imdbId ? _fetchImdbData(imdbId).catch(() => null) : Promise.resolve(null);
    const p2 = tmdbId ? _fetchTDetails(tmdbId).catch(() => null)  : Promise.resolve(null);
    const p3 = tmdbId ? _fetchTKeywords(tmdbId).catch(() => null) : Promise.resolve(null);

    Promise.all([p1, p2, p3]).then(([id, tdet, tk]) => {
      setImdbData(id);
      setTGenres(tdet?.genres || null);
      setTIsAdult(tdet?.is_adult ?? null);
      setTKeywords(tk);
      // Auto-fill editable fields from fetched IMDB data if still empty
      if (id?.vote_average != null) setEditRating(prev => prev || String(id.vote_average));
      if (id?.release_year)         setEditYear(prev   => prev || id.release_year);
      if (id?.original_language)    setEditLang(prev   => prev || id.original_language);
      setMetaLoading(false);
      setFetchDone(true);
    });
  }, []);

  const tagStyle = (accent) => ({
    cursor: 'pointer',
    background: 'var(--surface)',
    border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: '0.8rem',
    color: accent ? 'var(--accent)' : 'inherit',
    userSelect: 'none',
  });

  const sectionLabel = {
    fontSize: '0.72rem',
    fontWeight: 700,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 6,
  };

  const tmdbId = (match.tmdb_id !== 'not found' && match.id && !String(match.id).startsWith('tt'))
    ? String(match.id) : null;

  const cardStyle = {
    flex: 1,
    minWidth: 0,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    overflowY: 'auto',
  };

  const fieldRow = (label, value) => (
    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: '0.82rem', wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()}
        style={{ width: '92vw', maxWidth: 1100, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <span className="modal-title">Save — {match.title}</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        {metaLoading && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.82rem', padding: '6px 0' }}>
            Fetching metadata…
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, padding: '0 16px 0 16px', overflowY: 'hidden' }}>

          {/* ── Card 1: IMDB ── */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#f5c518', textTransform: 'uppercase', letterSpacing: '0.07em' }}>IMDB</span>
              {(imdbData?.poster_url || match.poster_url) && (
                <img src={imdbData?.poster_url || match.poster_url} alt="IMDB poster"
                  style={{ width: 48, height: 68, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
              )}
            </div>
            {fieldRow('IMDB ID',
              match.imdb_id
                ? <a href={`https://www.imdb.com/title/${match.imdb_id}`} target="_blank" rel="noreferrer"
                    style={{ color: '#f5c518', textDecoration: 'none' }}>{match.imdb_id}</a>
                : null
            )}
            {fieldRow('Rating',            imdbData?.vote_average != null ? String(imdbData.vote_average) : null)}
            {fieldRow('Votes',             imdbData?.vote_count    != null ? imdbData.vote_count.toLocaleString() : null)}
            {fieldRow('Release Year',      imdbData?.release_year  || null)}
            {fieldRow('Original Language', imdbData?.original_language || null)}
            {imdbData?.spoken_languages?.length > 0 && fieldRow('Spoken Languages', imdbData.spoken_languages.join(', '))}
            <div>
              <div style={sectionLabel}>i_genres</div>
              {imdbData?.genres?.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {imdbData.genres.map(g => (
                    <span key={g} style={tagStyle(false)} title="Add to Manual Genre"
                      onClick={() => setGenreChips(prev => prev.includes(g) ? prev : [...prev, g])}>{g}</span>
                  ))}
                </div>
              ) : <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{fetchDone ? '—' : ''}</span>}
            </div>
          </div>

          {/* ── Card 2: TMDB ── */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>TMDB</span>
              {match.poster_url && (
                <img src={match.poster_url} alt="TMDB poster"
                  style={{ width: 48, height: 68, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
              )}
            </div>
            {fieldRow('TMDB ID',
              tmdbId
                ? <a href={`https://www.themoviedb.org/movie/${tmdbId}`} target="_blank" rel="noreferrer"
                    style={{ color: 'var(--accent)', textDecoration: 'none' }}>{tmdbId}</a>
                : null
            )}
            {fieldRow('Updated_release_year', match.release_date ? match.release_date.slice(0, 4) : null)}
            {fieldRow('Original_Language', match.original_language)}
            {tIsAdult !== null && fieldRow('Is Adult', tIsAdult ? 'Yes' : 'No')}
            <div>
              <div style={sectionLabel}>t_genres</div>
              {tGenres?.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {tGenres.map(g => (
                    <span key={g} style={tagStyle(false)} title="Add to Manual Genre"
                      onClick={() => setGenreChips(prev => prev.includes(g) ? prev : [...prev, g])}>{g}</span>
                  ))}
                </div>
              ) : <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{fetchDone ? '—' : ''}</span>}
            </div>
            {tKeywords?.length > 0 && (
              <div>
                <div style={sectionLabel}>t_keywords</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {tKeywords.slice(0, 30).map(k => (
                    <span key={k} style={tagStyle(true)} title="Add to Manual Keywords"
                      onClick={() => setKwChips(prev => prev.includes(k) ? prev : [...prev, k])}>{k}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Card 3: Will be saved to CSV ── */}
          <div style={cardStyle}>
            <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#4caf50', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              Saves to CSV
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
              {fieldRow('IMDB ID', match.imdb_id)}
              {fieldRow('TMDB ID', tmdbId)}
            </div>
            {[
              ['source_1_rating',      editRating, setEditRating, 'e.g. 7.5'],
              ['Updated_release_year', editYear,   setEditYear,   'e.g. 2023'],
              ['Original_Language',    editLang,   setEditLang,   'e.g. ml'],
            ].map(([label, val, setter, ph]) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
                <input
                  className="modal-input"
                  value={val}
                  onChange={e => setter(e.target.value)}
                  placeholder={ph}
                  style={{ padding: '4px 8px', fontSize: '0.82rem' }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Manual_Genre</span>
              <ChipInput chips={genreChips} onChange={setGenreChips} placeholder="Type and press Enter or ," />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Manual_Keywords</span>
              <ChipInput chips={kwChips} onChange={setKwChips} placeholder="Type and press Enter or ," />
            </div>
          </div>

        </div>

        <div className="modal-footer" style={{ marginTop: 12 }}>
          <button className="modal-btn modal-btn--cancel" onClick={onCancel} disabled={loading}>Cancel</button>
          <button className="modal-btn modal-btn--confirm"
            onClick={() => onConfirm(genreChips.join(', '), kwChips.join(', '), { rating: editRating, release_year: editYear, original_language: editLang, is_adult: tIsAdult })} disabled={loading}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// A single match tile inside the carousel
function MatchCard({ match, projectId, contentId, contentRow, isSelected, disableSelect, onSelect, onRemove, folderReady, onNeedFolder }) {
  const [loading, setLoading]     = useState(false);
  const [showModal, setShowModal] = useState(false);

  const handleConfirm = async (genre, keywords, overrides = {}) => {
    if (!folderReady) { onNeedFolder(); return; }
    try {
      setLoading(true);
      const patchedMatch = {
        ...match,
        imdb_rating:       overrides.rating            ?? match.imdb_rating,
        release_date:      overrides.release_year      ? `${overrides.release_year}-01-01` : match.release_date,
        original_language: overrides.original_language ?? match.original_language,
      };
      const row = buildEnrichmentRow(contentRow, patchedMatch, genre, keywords, overrides);
      await saveEnrichmentRow(projectId, row);
      setShowModal(false);
      onSelect(match.id);
    } catch (err) {
      console.error(err);
      alert("Failed to save match: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!folderReady) { onNeedFolder(); return; }
    try {
      setLoading(true);
      await removeEnrichmentRow(projectId, contentId);
      onRemove();
    } catch (err) {
      console.error(err);
      alert("Failed to remove match: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {showModal && (
        <SelectModal
          match={match}
          onConfirm={handleConfirm}
          onCancel={() => setShowModal(false)}
          loading={loading}
        />
      )}
      <div className={`match-card${isSelected ? ' match-card--selected' : ''}`}>
        {match.poster_url ? (
          <img src={match.poster_url} alt={match.title} loading="lazy" />
        ) : (
          <div className="match-no-img">🎬</div>
        )}
        <div className="match-card-body">
          <div className="match-card-title">{match.title || '—'}</div>
          <div className="match-field" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {match.imdb_id && (
              <a href={`https://www.imdb.com/title/${match.imdb_id}`} target="_blank" rel="noreferrer"
                style={{ color: '#f5c518', fontWeight: 600, fontSize: '0.78rem', textDecoration: 'none' }}
                title="Open on IMDb">
                i_id: {match.imdb_id}
              </a>
            )}
            {match.id && (
              <a href={`https://www.themoviedb.org/movie/${match.id}`} target="_blank" rel="noreferrer"
                style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.78rem', textDecoration: 'none' }}
                title="Open on TMDB">
                t_id: {match.id}
              </a>
            )}
          </div>
          <div className="match-field">Director: <span>{match.director || '—'}</span></div>
          <div className="match-field match-cast">Cast: <span style={{ textTransform: 'capitalize' }}>{match.cast || '—'}</span></div>
          <div className="match-field">Genres: <span>{match.genres || '—'}</span></div>
          <div className="match-field">
            IMDb: <span>{match.imdb_rating != null ? match.imdb_rating : '—'}</span>
          </div>
          <div className="match-field">Year: <span>{match.release_date ? match.release_date.slice(0, 4) : '—'}</span></div>
          <span className="sim-badge">
            {(match.similarity * 100).toFixed(0)}% match
          </span>
        </div>
        <button
          className="match-select-btn"
          onClick={isSelected ? handleRemove : () => setShowModal(true)}
          disabled={loading || (!isSelected && disableSelect)}
        >
          {loading ? '...' : isSelected ? 'Remove' : 'Select'}
        </button>
      </div>
    </>
  )
}

// Advanced-search result tile (same shape as MatchCard, IMDB data)
function AdvSearchCard({ result, projectId, contentId, contentRow, isSelected, disableSelect, onSelect, onRemove, folderReady, onNeedFolder }) {
  const [loading, setLoading]     = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Adapt IMDB result to the match shape expected by SelectModal / buildEnrichmentRow
  const matchPayload = {
    id:                result.imdb_id,
    tmdb_id:           'not found',
    title:             result.title,
    poster_url:        result.poster_url,
    genres:            result.genres,
    imdb_rating:       result.imdb_rating || null,
    release_date:      result.year ? `${result.year}-01-01` : '',
    original_language: result.original_language || '',
    imdb_id:           result.imdb_id,
    similarity:        null,
    director:          result.director || '',
    cast:              result.cast || '',
  };

  const handleConfirm = async (genre, keywords, overrides = {}) => {
    if (!folderReady) { onNeedFolder(); return; }
    try {
      setLoading(true);
      const patchedMatch = {
        ...matchPayload,
        imdb_rating:       overrides.rating            ?? matchPayload.imdb_rating,
        release_date:      overrides.release_year      ? `${overrides.release_year}-01-01` : matchPayload.release_date,
        original_language: overrides.original_language ?? matchPayload.original_language,
      };
      const row = buildEnrichmentRow(contentRow, patchedMatch, genre, keywords, overrides);
      await saveEnrichmentRow(projectId, row);
      setShowModal(false);
      onSelect(result.imdb_id);
    } catch (err) {
      console.error(err);
      alert('Failed to save match: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!folderReady) { onNeedFolder(); return; }
    try {
      setLoading(true);
      await removeEnrichmentRow(projectId, contentId);
      onRemove();
    } catch (err) {
      console.error(err);
      alert('Failed to remove match: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {showModal && (
        <SelectModal
          match={matchPayload}
          onConfirm={handleConfirm}
          onCancel={() => setShowModal(false)}
          loading={loading}
        />
      )}
      <div className={`match-card${isSelected ? ' match-card--selected' : ''}`}>
        {result.poster_url ? (
          <img src={result.poster_url} alt={result.title} loading="lazy" />
        ) : (
          <div className="match-no-img">🎬</div>
        )}
        <div className="match-card-body">
          <div className="match-card-title">{result.title || '—'}</div>
          <div className="match-field">
            IMDb:&nbsp;
            <a href={`https://www.imdb.com/title/${result.imdb_id}`} target="_blank" rel="noreferrer"
              style={{ color: 'var(--accent)' }}>
              {result.imdb_id || '—'}
            </a>
          </div>
          <div className="match-field">Director: <span>{result.director || '—'}</span></div>
          <div className="match-field match-cast">Cast: <span style={{ textTransform: 'capitalize' }}>{result.cast || '—'}</span></div>
          <div className="match-field">Year: <span>{result.year || '—'}</span></div>
          {result.imdb_rating && <div className="match-field">Rating: <span>⭐ {result.imdb_rating}</span></div>}
          {result.genres && <div className="match-field">Genres: <span>{result.genres}</span></div>}
        </div>
        <button
          className="match-select-btn"
          onClick={isSelected ? handleRemove : () => setShowModal(true)}
          disabled={loading || (!isSelected && disableSelect)}
        >
          {loading ? '...' : isSelected ? 'Remove' : 'Select'}
        </button>
      </div>
    </>
  );
}

// Content preview card (filter list view + inline carousel)
function ContentCard({ item, projectId, filterDate, enrichActive, highlight, savedState = {}, onStateChange = () => {}, moderation = null, folderReady, onNeedFolder }) {
  // Initialise from savedState so values survive page navigation
  const [selectedMatchId,   setSelectedMatchId_]   = useState(savedState.selectedMatchId   ?? null);
  const [manualSaved,       setManualSaved_]        = useState(savedState.manualSaved       ?? false);
  const [manualLoading,     setManualLoading]       = useState(false);
  const [advResults,        setAdvResults_]         = useState(savedState.advResults        ?? null);
  const [advLoading,        setAdvLoading]          = useState(false);
  const [advSelectedId,     setAdvSelectedId_]      = useState(savedState.advSelectedId     ?? null);
  const [dubbedResults,     setDubbedResults_]      = useState(savedState.dubbedResults     ?? null);
  const [dubbedLoading,     setDubbedLoading]       = useState(false);
  const [dubbedSelectedId,  setDubbedSelectedId_]   = useState(savedState.dubbedSelectedId  ?? null);

  // Wrappers that also persist back to the parent ref
  const setSelectedMatchId  = (v) => { setSelectedMatchId_(v);  onStateChange({ selectedMatchId: v }); };
  const setManualSaved      = (v) => { setManualSaved_(v);      onStateChange({ manualSaved: v }); };
  const setAdvResults       = (v) => { setAdvResults_(v);       onStateChange({ advResults: v }); };
  const setAdvSelectedId    = (v) => { setAdvSelectedId_(v);    onStateChange({ advSelectedId: v }); };
  const setDubbedResults    = (v) => { setDubbedResults_(v);    onStateChange({ dubbedResults: v }); };
  const setDubbedSelectedId = (v) => { setDubbedSelectedId_(v); onStateChange({ dubbedSelectedId: v }); };

  const handleAdvancedSearch = async () => {
    try {
      setAdvLoading(true);
      const data = await advancedSearch(projectId, item.contentid);
      setAdvResults(data.results);
    } catch (err) {
      console.error(err);
      alert('Advanced search failed.');
    } finally {
      setAdvLoading(false);
    }
  };

  const handleDubbedSearch = async () => {
    try {
      setDubbedLoading(true);
      const data = await dubbedSearch(projectId, item.contentid);
      setDubbedResults(data.matches);
    } catch (err) {
      console.error(err);
      alert('Dubbed search failed.');
    } finally {
      setDubbedLoading(false);
    }
  };

  const handleManualEnrich = async () => {
    if (!folderReady) { onNeedFolder(); return; }
    try {
      setManualLoading(true);
      const row = buildManualRow(item);
      await saveManualRow(projectId, row);
      setManualSaved(true);
    } catch (err) {
      console.error(err);
      alert("Failed to save manual enrichment: " + err.message);
    } finally {
      setManualLoading(false);
    }
  };

  const handleManualRemove = async () => {
    if (!folderReady) { onNeedFolder(); return; }
    try {
      setManualLoading(true);
      await removeManualRow(projectId, item.contentid);
      setManualSaved(false);
    } catch (err) {
      console.error(err);
      alert("Failed to remove manual enrichment: " + err.message);
    } finally {
      setManualLoading(false);
    }
  };

  return (
    <div className={`content-card${highlight ? ' content-card--highlight' : ''}`} style={{ position: 'relative' }}>
      {enrichActive && (
        <div className="manual-enrich-actions">
          <button
            className={`manual-enrich-btn${manualSaved ? ' manual-enrich-btn--saved' : ''}`}
            onClick={handleManualEnrich}
            disabled={manualLoading || manualSaved}
          >
            {manualLoading && !manualSaved ? '...' : manualSaved ? 'Saved' : 'Manual Enrich'}
          </button>
          {manualSaved && (
            <button
              className="manual-remove-btn"
              onClick={handleManualRemove}
              disabled={manualLoading}
            >
              {manualLoading ? '...' : 'Remove'}
            </button>
          )}
          <button
            className="adv-search-btn"
            onClick={handleAdvancedSearch}
            disabled={advLoading}
          >
            {advLoading ? '...' : 'Advanced Search'}
          </button>
          <button
            className="dubbed-search-btn"
            onClick={handleDubbedSearch}
            disabled={dubbedLoading}
          >
            {dubbedLoading ? '...' : 'Dubbed Content?'}
          </button>
        </div>
      )}
      <div className="content-card-top">
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {item.imgurl ? (
            <img
              className="content-poster"
              src={item.imgurl}
              alt={item.contentname}
              onError={e => { e.target.style.display = 'none' }}
            />
          ) : (
            <div className="content-poster-placeholder">🎬</div>
          )}
          {moderation?.is_adult && (
            <span
              className={`adult-badge adult-badge--${moderation.tag}`}
              title={moderation.label_detail}
            >
              {moderation.tag === 'explicit' ? '🔞 Explicit' :
               moderation.tag === 'suggestive' ? '⚠ Suggestive' : '🔞 Adult'}
            </span>
          )}
        </div>

        <div className="content-info">
          <div className="content-title">{item.contentname || '—'}</div>
          <div className="content-meta">
            {item.director && (
              <span className="meta-pill">🎬 <span>{item.director}</span></span>
            )}
            {item.cast && (
              <span className="meta-pill meta-pill-cast" title={item.cast}>
                🎭 <span>{item.cast}</span>
              </span>
            )}
            {item.contenttype && (
              <span className="meta-pill">📁 <span>{item.contenttype}</span></span>
            )}
            {item.partnername && (
              <span className="meta-pill">🤝 <span>{item.partnername}</span></span>
            )}
          </div>
          <div className="content-id">
            ID: {item.contentid}
            {item.releaseyear && item.releaseyear !== '' && item.releaseyear !== 'nan' && (
              <span style={{ marginLeft: 12 }}>ReleaseYear: {String(item.releaseyear).replace(/\.0$/, '')}</span>
            )}
          </div>
        </div>
      </div>

      {advResults && (
        <div className="carousel-section" style={{ padding: '16px 0 0 0', marginTop: '16px', borderTop: '1px solid var(--border)' }}>
          <div className="carousel-label">🔍 Advanced Search Results ({advResults.length})</div>
          {advResults.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No results found.</p>
          ) : (
            <div className="carousel-track">
              {advResults.map((r) => (
                <AdvSearchCard
                  key={r.imdb_id}
                  result={r}
                  projectId={projectId}
                  filterDate={filterDate}
                  contentId={item.contentid}
                  contentRow={item}
                  isSelected={advSelectedId === r.imdb_id}
                  disableSelect={advSelectedId !== null && advSelectedId !== r.imdb_id}
                  onSelect={(id) => setAdvSelectedId(id)}
                  onRemove={() => setAdvSelectedId(null)}
                  folderReady={folderReady}
                  onNeedFolder={onNeedFolder}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {dubbedResults && (
        <div className="carousel-section" style={{ padding: '16px 0 0 0', marginTop: '16px', borderTop: '1px solid var(--border)' }}>
          <div className="carousel-label">🎙️ Dubbed Matches ({dubbedResults.length})</div>
          {dubbedResults.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No dubbed matches found.</p>
          ) : (
            <div className="carousel-track">
              {dubbedResults.map((m, idx) => (
                <MatchCard
                  key={idx}
                  match={m}
                  projectId={projectId}
                  filterDate={filterDate}
                  contentId={item.contentid}
                  contentRow={item}
                  isSelected={dubbedSelectedId === m.id}
                  disableSelect={dubbedSelectedId !== null && dubbedSelectedId !== m.id}
                  onSelect={(id) => setDubbedSelectedId(id)}
                  onRemove={() => setDubbedSelectedId(null)}
                  folderReady={folderReady}
                  onNeedFolder={onNeedFolder}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {item.matches && (
        <div className="carousel-section" style={{ padding: '16px 0 0 0', marginTop: '16px', borderTop: '1px solid var(--border)' }}>
          <div className="carousel-label">
            🔗 Top {item.matches.length} match{item.matches.length !== 1 ? 'es' : ''}
          </div>
          {item.matches.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No matches returned.</p>
          ) : (
            <div className="carousel-track">
              {item.matches.map((m, idx) => (
                <MatchCard
                  key={idx}
                  match={m}
                  projectId={projectId}
                  filterDate={filterDate}
                  contentId={item.contentid}
                  contentRow={item}
                  isSelected={selectedMatchId === m.id}
                  disableSelect={selectedMatchId !== null && selectedMatchId !== m.id}
                  onSelect={(id) => setSelectedMatchId(id)}
                  onRemove={() => setSelectedMatchId(null)}
                  folderReady={folderReady}
                  onNeedFolder={onNeedFolder}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
