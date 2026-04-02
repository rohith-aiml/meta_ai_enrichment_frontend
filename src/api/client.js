import axios from 'axios'

// Base URL pointing to the FastAPI backend
const api = axios.create({ baseURL: 'http://localhost:8000' })

export const getProjects = () =>
  api.get('/projects').then(r => r.data.projects)

export const getContentTypes = (projectId) =>
  api.get('/contenttypes', { params: { project_id: projectId } }).then(r => r.data.content_types)

export const getDates = (projectId, contentType) =>
  api.get('/dates', { params: { project_id: projectId, content_type: contentType } }).then(r => r.data.dates)

export const getPartners = (projectId, contentType, date) =>
  api.get('/partners', { params: { project_id: projectId, content_type: contentType, date } }).then(r => r.data.partners)

export const getEnrichedMetaStatuses = (projectId, contentType, date, partners) =>
  api.get('/enriched_meta_statuses', {
    params: { project_id: projectId, content_type: contentType, date, partners }
  }).then(r => r.data.statuses)

export const applyFilter = (body) =>
  api.post('/filter', body).then(r => r.data)

export const searchContents = (filterBody, q) =>
  api.post('/search', { ...filterBody, q }).then(r => r.data.results)

export const runEnrich = (body) =>
  api.post('/enrich', body).then(r => r.data)

export const saveMatch = (projectId, contentId, match, manualGenre, manualKeywords) =>
  api.post('/select_match', {
    project_id: projectId,
    contentid: contentId,
    match,
    manual_genre: manualGenre,
    manual_keywords: manualKeywords,
  }).then(r => r.data)

export const removeMatch = (projectId, contentId) =>
  api.post('/remove_match', { project_id: projectId, contentid: contentId }).then(r => r.data)

export const advancedSearch = (projectId, contentId) =>
  api.post('/advanced_search', { project_id: projectId, contentid: contentId }).then(r => r.data)

export const dubbedSearch = (projectId, contentId) =>
  api.post('/dubbed_search', { project_id: projectId, contentid: contentId }).then(r => r.data)

export const manualEnrich = (projectId, contentId) =>
  api.post('/manual_enrich', { project_id: projectId, contentid: contentId }).then(r => r.data)

export const removeManualEnrich = (projectId, contentId) =>
  api.post('/remove_manual_enrich', { project_id: projectId, contentid: contentId }).then(r => r.data)

// items: [{contentid, imgurl}, ...]  →  { results: { contentid: {tag, is_adult, label_detail, ...} } }
export const moderateImages = (items) =>
  api.post('/moderate', { items }, { timeout: 120_000 }).then(r => r.data.results)
