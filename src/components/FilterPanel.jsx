import { useState, useEffect } from 'react'
import Select from 'react-select'
import {
  getProjects,
  getContentTypes,
  getDates,
  getPartners,
  getEnrichedMetaStatuses,
} from '../api/client'

// Converts an array of strings to react-select option objects
const toOptions = (arr) => arr.map(v => ({ value: v, label: v }))

export default function FilterPanel({
  onApply,
  onEnrich,
  loading,
  enrichLoading,
  filterCount,
}) {
  const [projects, setProjects]           = useState([])
  const [contentTypes, setContentTypes]   = useState([])
  const [dates, setDates]                 = useState([])
  const [partnerOpts, setPartnerOpts]     = useState([])
  const [statusOpts, setStatusOpts]       = useState([])

  // Selected values
  const [project, setProject]                       = useState('')
  const [contentType, setContentType]               = useState('')
  const [date, setDate]                             = useState('')
  const [selectedPartners, setSelectedPartners]     = useState([])
  const [enrichedMetaStatus, setEnrichedMetaStatus] = useState('')

  // Load project list on mount
  useEffect(() => {
    getProjects().then(list => {
      setProjects(list)
      if (list.length === 1) setProject(list[0])
    })
  }, [])

  // When project changes — cascade load content types
  useEffect(() => {
    if (!project) return
    setContentType('')
    setDate('')
    setSelectedPartners([])
    setEnrichedMetaStatus('')
    getContentTypes(project).then(list => setContentTypes(list))
  }, [project])

  // When content type changes — cascade load dates
  useEffect(() => {
    if (!project || !contentType) return
    setDate('')
    setSelectedPartners([])
    setEnrichedMetaStatus('')
    getDates(project, contentType).then(list => {
      setDates(list)
      if (list.length > 0) setDate(list[0])
    })
  }, [contentType])

  // When date changes — load partner options
  useEffect(() => {
    if (!project || !contentType || !date) return
    setSelectedPartners([])
    setEnrichedMetaStatus('')
    getPartners(project, contentType, date).then(list => setPartnerOpts(toOptions(list)))
  }, [date])

  // When partners change — reload enriched meta statuses
  useEffect(() => {
    if (!project || !contentType || !date) return
    setEnrichedMetaStatus('')
    getEnrichedMetaStatuses(
      project, contentType, date, selectedPartners.map(p => p.value)
    ).then(list => setStatusOpts(list))
  }, [selectedPartners, date])

  const canApply  = project && contentType && date
  const canEnrich = canApply && filterCount > 0 && !loading

  const _filterBody = () => ({
    project_id:           project,
    content_type:         contentType,
    date,
    partners:             selectedPartners.map(p => p.value),
    enriched_meta_status: enrichedMetaStatus,
    page:                 1,
    page_size:            50,
  })

  const handleApply  = () => { if (canApply)  onApply(_filterBody()) }
  const handleEnrich = () => { if (canEnrich) onEnrich(_filterBody()) }

  return (
    <div className="filter-panel">
      <h2>🔍 Filter Contents</h2>

      <div className="filter-grid">
        {/* Project ID */}
        <div className="filter-field">
          <label>Project ID</label>
          <select value={project} onChange={e => setProject(e.target.value)}>
            <option value="">— Select project —</option>
            {projects.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Content Type */}
        <div className="filter-field">
          <label>Content Type</label>
          <select
            value={contentType}
            onChange={e => setContentType(e.target.value)}
            disabled={!project}
          >
            <option value="">— Select type —</option>
            {contentTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Published Date */}
        <div className="filter-field">
          <label>Published Date</label>
          <select
            value={date}
            onChange={e => setDate(e.target.value)}
            disabled={!contentType}
          >
            <option value="">— Select date —</option>
            {dates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Partner (multi-select) */}
        <div className="filter-field">
          <label>Partner (multi)</label>
          <Select
            isMulti
            options={partnerOpts}
            value={selectedPartners}
            onChange={setSelectedPartners}
            isDisabled={!date || partnerOpts.length === 0}
            placeholder="All partners"
            classNamePrefix="rs"
            styles={{ container: base => ({ ...base, width: '100%' }) }}
          />
        </div>

        {/* Enriched Meta Status */}
        <div className="filter-field">
          <label>Enriched Meta Status</label>
          <select
            value={enrichedMetaStatus}
            onChange={e => setEnrichedMetaStatus(e.target.value)}
            disabled={!date || statusOpts.length === 0}
          >
            <option value="">— All statuses —</option>
            {statusOpts.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Actions row */}
      <div className="filter-actions">
        <button
          className="btn btn-primary"
          onClick={handleApply}
          disabled={!canApply || loading}
        >
          {loading ? '⏳ Loading…' : '▶ Apply Filters'}
        </button>

        <button
          className="btn btn-success"
          onClick={handleEnrich}
          disabled={!canEnrich || enrichLoading}
        >
          {enrichLoading ? '⏳ Enriching…' : 'Enrich'}
        </button>

        {filterCount !== null && (
          <div className="count-chip">
            📄 <strong>{filterCount}</strong> contents found
          </div>
        )}
      </div>
    </div>
  )
}
