import { useState, useEffect, useRef } from 'react'
import FilterPanel from './components/FilterPanel'
import Pagination from './components/Pagination'
import { applyFilter, runEnrich, saveMatch, removeMatch, manualEnrich, removeManualEnrich, searchContents, advancedSearch, dubbedSearch, moderateImages } from './api/client'

export default function App() {
  // Filter results state
  const [filterResult, setFilterResult]   = useState(null)  // { count, page, total_pages, contents }
  const [filterLoading, setFilterLoading] = useState(false)
  const [filterError, setFilterError]     = useState('')

  // Enrich state
  const [enrichLoading, setEnrichLoading] = useState(false)
  const [enrichError, setEnrichError]     = useState('')

  // Keep the last filter body so we can re-use it for pagination clicks
  const [lastFilter, setLastFilter]       = useState(null)
  const [enrichActive, setEnrichActive]   = useState(false)

  // Cache enriched page results so navigating back doesn't re-fetch or re-enrich
  // { pageNum: filterResult } — cleared whenever a new filter is applied
  const pageResultsCacheRef = useRef({})

  // Persist per-card UI state (selections, search results) across page navigation
  // { contentid: { selectedMatchId, manualSaved, advResults, advSelectedId, dubbedResults, dubbedSelectedId } }
  const cardStateRef = useRef({})

  // Moderation results: { contentid → {tag, is_adult, label_detail, ...} }
  // Populated in the background after each filter/page load
  const [moderationMap, setModerationMap] = useState({})

  const getCardState    = (cid) => cardStateRef.current[cid] || {}
  const updateCardState = (cid, patch) => {
    cardStateRef.current[cid] = { ...cardStateRef.current[cid], ...patch }
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

      // Merge results into filterResult.contents and update the page cache
      setFilterResult(prev => {
        if (!prev || !data.results) return prev
        const enrichedContents = prev.contents.map(item => {
          const matchData = data.results.find(res => res.contentid === item.contentid)
          return matchData ? { ...item, matches: matchData.matches } : item
        })
        const updated = { ...prev, contents: enrichedContents }
        pageResultsCacheRef.current[prev.page] = updated   // cache enriched page
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
                enrichActive={enrichActive}
                highlight={highlightId === item.contentid}
                savedState={getCardState(item.contentid)}
                onStateChange={(patch) => updateCardState(item.contentid, patch)}
                moderation={moderationMap[item.contentid] || null}
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

// ── TMDB API keys (rotated on 429/401) ────────────────────────────────────────
const _TMDB_KEYS = [
  'a2f888b27315e62e471b2d587048f32e',
  '8476a7ab80ad76f0936744df0430e67c',
  '5622cafbfe8f8cfe358a29c53e19bba0',
  'ae4bd1b6fce2a5648671bfc171d15ba0',
  '257654f35e3dff105574f97fb4b97035',
  '2f4038e83265214a0dcd6ec2eb3276f5',
  '9e43f45f94705cc8e1d5a0400d19a7b7',
  'af6887753365e14160254ac7f4345dd2',
  '06f10fc8741a672af455421c239a1ffc',
  'fb7bb23f03b6994dafc674c074d01761',
  '09ad8ace66eec34302943272db0e8d2c',
  '7bca32596da7d3ef9aa511c95aee829b',
  '8f6d7a3e2e959ece2c1ea2c10adfa6b9',
  '69c6b9362872f8b7d98effec5badddd6',
  'ca357c71903c409f2ce08d61e75700a6',
  '3d5965dd1fd2903e4ab6854c6003559f',
];

// IMDB data: look up movie by IMDB id via TMDB /find, then fetch full details
// Returns { genres, vote_count, vote_average, release_year, original_language, spoken_languages }
async function _fetchImdbData(imdbId) {
  for (const key of _TMDB_KEYS) {
    try {
      const findRes = await fetch(
        `https://api.themoviedb.org/3/find/${imdbId}?api_key=${key}&external_source=imdb_id`
      );
      if (findRes.status === 429 || findRes.status === 401) continue;
      if (!findRes.ok) continue;
      const findData = await findRes.json();
      const movies = findData.movie_results || [];
      if (!movies.length) return {};
      const findPoster = movies[0].poster_path
        ? `https://image.tmdb.org/t/p/w300${movies[0].poster_path}` : null;
      const movieRes = await fetch(`https://api.themoviedb.org/3/movie/${movies[0].id}?api_key=${key}`);
      if (!movieRes.ok) continue;
      const d = await movieRes.json();
      return {
        genres:            (d.genres || []).map(g => g.name),
        vote_count:        d.vote_count ?? null,
        vote_average:      d.vote_average ?? null,
        release_year:      d.release_date ? d.release_date.slice(0, 4) : null,
        original_language: d.original_language || null,
        spoken_languages:  (d.spoken_languages || []).map(l => l.english_name || l.name).filter(Boolean),
        poster_url:        d.poster_path ? `https://image.tmdb.org/t/p/w300${d.poster_path}` : findPoster,
      };
    } catch { continue; }
  }
  return null;
}

// t_genres: genres from TMDB movie endpoint using TMDB id
async function _fetchTGenres(tmdbId) {
  for (const key of _TMDB_KEYS) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}`);
      if (res.status === 429 || res.status === 401) continue;
      if (!res.ok) continue;
      const data = await res.json();
      return (data.genres || []).map(g => g.name);
    } catch { continue; }
  }
  return null;
}

// t_keywords: keywords from TMDB movie keywords endpoint using TMDB id
async function _fetchTKeywords(tmdbId) {
  for (const key of _TMDB_KEYS) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/keywords?api_key=${key}`);
      if (res.status === 429 || res.status === 401) continue;
      if (!res.ok) continue;
      const data = await res.json();
      return (data.keywords || []).map(k => k.name);
    } catch { continue; }
  }
  return null;
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
    const p2 = tmdbId ? _fetchTGenres(tmdbId).catch(() => null)  : Promise.resolve(null);
    const p3 = tmdbId ? _fetchTKeywords(tmdbId).catch(() => null) : Promise.resolve(null);

    Promise.all([p1, p2, p3]).then(([id, tg, tk]) => {
      setImdbData(id);
      setTGenres(tg);
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
            onClick={() => onConfirm(genreChips.join(', '), kwChips.join(', '), { rating: editRating, release_year: editYear, original_language: editLang })} disabled={loading}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// A single match tile inside the carousel
function MatchCard({ match, projectId, contentId, isSelected, disableSelect, onSelect, onRemove }) {
  const [loading, setLoading]     = useState(false);
  const [showModal, setShowModal] = useState(false);

  const handleConfirm = async (genre, keywords, overrides = {}) => {
    try {
      setLoading(true);
      const patchedMatch = {
        ...match,
        imdb_rating:       overrides.rating           ?? match.imdb_rating,
        release_date:      overrides.release_year     ? `${overrides.release_year}-01-01` : match.release_date,
        original_language: overrides.original_language ?? match.original_language,
      };
      await saveMatch(projectId, contentId, patchedMatch, genre, keywords);
      setShowModal(false);
      onSelect(match.id);
    } catch (err) {
      console.error(err);
      alert("Failed to save match.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    try {
      setLoading(true);
      await removeMatch(projectId, contentId);
      onRemove();
    } catch (err) {
      console.error(err);
      alert("Failed to remove match.");
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
function AdvSearchCard({ result, projectId, contentId, isSelected, disableSelect, onSelect, onRemove }) {
  const [loading, setLoading]     = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Adapt IMDB result to the match shape expected by SelectModal / saveMatch
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
    try {
      setLoading(true);
      const patchedMatch = {
        ...matchPayload,
        imdb_rating:       overrides.rating            ?? matchPayload.imdb_rating,
        release_date:      overrides.release_year      ? `${overrides.release_year}-01-01` : matchPayload.release_date,
        original_language: overrides.original_language ?? matchPayload.original_language,
      };
      await saveMatch(projectId, contentId, patchedMatch, genre, keywords);
      setShowModal(false);
      onSelect(result.imdb_id);
    } catch (err) {
      console.error(err);
      alert('Failed to save match.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    try {
      setLoading(true);
      await removeMatch(projectId, contentId);
      onRemove();
    } catch (err) {
      console.error(err);
      alert('Failed to remove match.');
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
function ContentCard({ item, projectId, enrichActive, highlight, savedState = {}, onStateChange = () => {}, moderation = null }) {
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
    try {
      setManualLoading(true);
      await manualEnrich(projectId, item.contentid);
      setManualSaved(true);
    } catch (err) {
      console.error(err);
      alert("Failed to save manual enrichment.");
    } finally {
      setManualLoading(false);
    }
  };

  const handleManualRemove = async () => {
    try {
      setManualLoading(true);
      await removeManualEnrich(projectId, item.contentid);
      setManualSaved(false);
    } catch (err) {
      console.error(err);
      alert("Failed to remove manual enrichment.");
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
                  contentId={item.contentid}
                  isSelected={advSelectedId === r.imdb_id}
                  disableSelect={advSelectedId !== null && advSelectedId !== r.imdb_id}
                  onSelect={(id) => setAdvSelectedId(id)}
                  onRemove={() => setAdvSelectedId(null)}
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
                  contentId={item.contentid}
                  isSelected={dubbedSelectedId === m.id}
                  disableSelect={dubbedSelectedId !== null && dubbedSelectedId !== m.id}
                  onSelect={(id) => setDubbedSelectedId(id)}
                  onRemove={() => setDubbedSelectedId(null)}
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
                  contentId={item.contentid} 
                  isSelected={selectedMatchId === m.id}
                  disableSelect={selectedMatchId !== null && selectedMatchId !== m.id}
                  onSelect={(id) => setSelectedMatchId(id)}
                  onRemove={() => setSelectedMatchId(null)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
