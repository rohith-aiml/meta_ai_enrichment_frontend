/**
 * localCsv.js — write enrichment results directly to the user's local filesystem
 * using the File System Access API (Chrome / Edge).
 *
 * File layout chosen by user once via folder picker, then remembered in IndexedDB:
 *   <chosen_root>/<project_id>/<date>/enrichment.csv
 *   <chosen_root>/<project_id>/<date>/manual_enrichment.csv
 */

// ── ISO 639 code → full language name (lowercase) ────────────────────────────
const _LANG_MAP = {
  en: 'english',   hi: 'hindi',      ta: 'tamil',       te: 'telugu',
  ml: 'malayalam', kn: 'kannada',    mr: 'marathi',     gu: 'gujarati',
  pa: 'punjabi',   bn: 'bangla',     ur: 'urdu',        or: 'odia',
  as: 'assamese',  ks: 'kashmiri',   sd: 'sindhi',      sa: 'sanskrit',
  ne: 'nepali',    si: 'sinhala',    my: 'burmese',     th: 'thai',
  ko: 'korean',    ja: 'japanese',   zh: 'chinese',     fr: 'french',
  de: 'german',    es: 'spanish',    it: 'italian',     pt: 'portuguese',
  ru: 'russian',   ar: 'arabic',     tr: 'turkish',     fa: 'persian',
  id: 'indonesian',ms: 'malay',      vi: 'vietnamese',  tl: 'filipino',
  bho: 'bhojpuri', mai: 'maithili',  raj: 'rajasthani', awa: 'awadhi',
  doi: 'dogri',    sat: 'santali',   mni: 'manipuri',   kok: 'konkani',
  bo: 'tibetan',   dz: 'dzongkha',   sw: 'swahili',     nl: 'dutch',
  pl: 'polish',    ro: 'romanian',   hu: 'hungarian',   cs: 'czech',
  el: 'greek',     he: 'hebrew',     fi: 'finnish',     sv: 'swedish',
  no: 'norwegian', da: 'danish',     uk: 'ukrainian',   bg: 'bulgarian',
  sr: 'serbian',   hr: 'croatian',   sk: 'slovak',      lt: 'lithuanian',
  lv: 'latvian',   et: 'estonian',   sq: 'albanian',    mk: 'macedonian',
  bs: 'bosnian',   sl: 'slovenian',  ka: 'georgian',    hy: 'armenian',
  az: 'azerbaijani', kk: 'kazakh',   uz: 'uzbek',       tk: 'turkmen',
  mn: 'mongolian', km: 'khmer',      lo: 'lao',         am: 'amharic',
  so: 'somali',    ha: 'hausa',      yo: 'yoruba',      ig: 'igbo',
  zu: 'zulu',      xh: 'xhosa',      af: 'afrikaans',   cy: 'welsh',
  ga: 'irish',     eu: 'basque',     ca: 'catalan',     gl: 'galician',
  is: 'icelandic', mt: 'maltese',    lb: 'luxembourgish',
}

/** Convert an ISO 639 code to a full lowercase language name. */
function _langName(code) {
  if (!code) return ''
  const key = String(code).trim().toLowerCase()
  return _LANG_MAP[key] || key   // fall back to the code itself if unknown
}

const IDB_NAME    = 'meta_enr_fs'
const IDB_STORE   = 'handles'
const IDB_KEY     = 'root_dir'
const CSV_HEADERS = [
  'contentid', 'contentname', 'contenttype', 'language', 'releaseyear',
  'source_1_rating', 'Manual_Genre', 'Manual_Keywords', 'Updated_release_year',
  'Original_Language', 'IMDB ID', 'TMDB ID', 'Partner_Genre', 'cast', 'Partner', 'Date',
]

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function _openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function _saveHandle(handle) {
  const db = await _openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readwrite')
    const req = tx.objectStore(IDB_STORE).put(handle, IDB_KEY)
    req.onsuccess = resolve
    req.onerror   = () => reject(req.error)
  })
}

async function _loadHandle() {
  const db = await _openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror   = () => reject(req.error)
  })
}

// ── Root directory ────────────────────────────────────────────────────────────

let _rootHandle = null   // in-memory cache for the session

/**
 * Returns the stored root directory handle, verifying permission is still granted.
 * Returns null if never set or permission was revoked.
 */
export async function getRootHandle() {
  if (_rootHandle) return _rootHandle
  try {
    const handle = await _loadHandle()
    if (!handle) return null
    // Re-verify permission (user may have revoked it)
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') { _rootHandle = handle; return handle }
    // Try to re-request silently
    const req = await handle.requestPermission({ mode: 'readwrite' })
    if (req === 'granted') { _rootHandle = handle; return handle }
    return null
  } catch { return null }
}

/**
 * Prompt the user to pick a base folder (once).
 * Saves the handle to IndexedDB so future sessions skip the prompt.
 */
export async function pickRootFolder() {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('File System Access API not supported in this browser. Use Chrome or Edge.')
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' })
  await _saveHandle(handle)
  _rootHandle = handle
  return handle
}

/** Returns true if a root folder is already chosen and accessible. */
export async function hasRootFolder() {
  return (await getRootHandle()) !== null
}

/** Today's date as YYYYMMDD — used as the date folder name. */
export function todayFolder() {
  const d = new Date()
  const yy = d.getFullYear()
  const mm  = String(d.getMonth() + 1).padStart(2, '0')
  const dd  = String(d.getDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

/**
 * Returns { rootName, fullPath } for the tooltip.
 * rootName — just the picked folder name (e.g. "Documents" or "meta_enr_output")
 * fullPath — rootName / projectId / YYYYMMDD  (projectId optional)
 */
export async function getFolderInfo(projectId) {
  const root = await getRootHandle()
  if (!root) return null
  const rootName = root.name
  const fullPath = projectId
    ? `${rootName} / ${projectId} / ${todayFolder()}`
    : `${rootName} / <project> / ${todayFolder()}`
  return { rootName, fullPath }
}

// ── File helpers ──────────────────────────────────────────────────────────────

async function _getOrCreateDir(parent, name) {
  return parent.getDirectoryHandle(name, { create: true })
}

async function _readCsv(fileHandle) {
  const file = await fileHandle.getFile()
  const text = await file.text()
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []   // header only or empty
  const headers = _parseCsvLine(lines[0])
  return lines.slice(1).map(line => {
    const vals = _parseCsvLine(line)
    const obj  = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  })
}

function _parseCsvLine(line) {
  // Simple CSV parser — handles quoted fields with commas inside
  const result = []
  let cur = '', inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuote = !inQuote }
    else if (ch === ',' && !inQuote) { result.push(cur); cur = '' }
    else { cur += ch }
  }
  result.push(cur)
  return result
}

function _toCsvLine(row, headers) {
  return headers.map(h => {
    const v = String(row[h] ?? '')
    return v.includes(',') || v.includes('"') || v.includes('\n')
      ? `"${v.replace(/"/g, '""')}"` : v
  }).join(',')
}

async function _writeCsv(fileHandle, rows) {
  const writable = await fileHandle.createWritable()
  const lines    = [CSV_HEADERS.join(','), ...rows.map(r => _toCsvLine(r, CSV_HEADERS))]
  await writable.write(lines.join('\n') + '\n')
  await writable.close()
}

async function _getCsvHandle(projectId, filename) {
  const root    = await getRootHandle()
  if (!root) throw new Error('NO_ROOT')
  const projDir = await _getOrCreateDir(root, projectId)
  const dateDir = await _getOrCreateDir(projDir, todayFolder())
  return dateDir.getFileHandle(filename, { create: true })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Append or update a row in enrichment.csv.
 * If contentid already exists, the row is replaced.
 */
export async function saveEnrichmentRow(projectId, row) {
  const handle   = await _getCsvHandle(projectId, 'enrichment.csv')
  const existing = await _readCsv(handle)
  const filtered = existing.filter(r => r.contentid !== row.contentid)
  await _writeCsv(handle, [...filtered, row])
}

/**
 * Remove a row from enrichment.csv by contentid.
 */
export async function removeEnrichmentRow(projectId, contentId) {
  const handle   = await _getCsvHandle(projectId, 'enrichment.csv')
  const existing = await _readCsv(handle)
  const filtered = existing.filter(r => r.contentid !== contentId)
  await _writeCsv(handle, filtered)
}

/**
 * Append or update a row in manual_enrichment.csv.
 */
export async function saveManualRow(projectId, row) {
  const handle   = await _getCsvHandle(projectId, 'manual_enrichment.csv')
  const existing = await _readCsv(handle)
  const filtered = existing.filter(r => r.contentid !== row.contentid)
  await _writeCsv(handle, [...filtered, row])
}

/**
 * Remove a row from manual_enrichment.csv by contentid.
 */
export async function removeManualRow(projectId, contentId) {
  const handle   = await _getCsvHandle(projectId, 'manual_enrichment.csv')
  const existing = await _readCsv(handle)
  const filtered = existing.filter(r => r.contentid !== contentId)
  await _writeCsv(handle, filtered)
}

/**
 * Build the enrichment row from content + match data.
 * Same columns as the server-side CSV.
 */
export function buildEnrichmentRow(contentRow, match, manualGenre, manualKeywords, overrides = {}) {
  const tmdbId = (match.tmdb_id !== 'not found' && match.id && !String(match.id).startsWith('tt'))
    ? String(match.id) : ''
  return {
    contentid:             String(contentRow.contentid   || ''),
    contentname:           String(contentRow.contentname || ''),
    contenttype:           String(contentRow.contenttype || ''),
    language:              String(contentRow.language    || ''),
    releaseyear:           String(contentRow.releaseyear || '').replace(/\.0$/, ''),
    source_1_rating:       String(overrides.rating           ?? match.imdb_rating ?? ''),
    Manual_Genre:          (manualGenre || String(match.genres || '')).toLowerCase(),
    Manual_Keywords:       (manualKeywords || '').toLowerCase(),
    Updated_release_year:  overrides.release_year
                             || (match.release_date ? match.release_date.slice(0, 4) : ''),
    Original_Language:     _langName(overrides.original_language ?? match.original_language ?? ''),
    'IMDB ID':             String(match.imdb_id  || ''),
    'TMDB ID':             tmdbId,
    Partner_Genre:         String(contentRow.genre       || ''),
    cast:                  String(contentRow.cast        || ''),
    Partner:               String(contentRow.partnername || ''),
    Date:                  new Date().toISOString().slice(0, 10),
  }
}

export function buildManualRow(contentRow) {
  return {
    contentid:             String(contentRow.contentid   || ''),
    contentname:           String(contentRow.contentname || ''),
    contenttype:           String(contentRow.contenttype || ''),
    language:              String(contentRow.language    || ''),
    releaseyear:           String(contentRow.releaseyear || '').replace(/\.0$/, ''),
    source_1_rating:       '',
    Manual_Genre:          '',
    Manual_Keywords:       '',
    Updated_release_year:  '',
    Original_Language:     '',
    'IMDB ID':             '',
    'TMDB ID':             '',
    Partner_Genre:         String(contentRow.genre       || ''),
    cast:                  String(contentRow.cast        || ''),
    Partner:               String(contentRow.partnername || ''),
    Date:                  new Date().toISOString().slice(0, 10),
  }
}
