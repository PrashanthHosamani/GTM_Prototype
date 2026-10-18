
let currentData = null;

document.addEventListener('DOMContentLoaded', () => {
  ['companyInput', 'domainInput', 'objectiveInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          executeResearch();
        }
      });
    }
  });
});

function setCompany(name, domain) {
  document.getElementById('companyInput').value = name;
  document.getElementById('domainInput').value = domain;
  executeResearch();
}

function newSearch() {
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('heroSection').style.display = 'block';
  document.getElementById('companyInput').value = '';
  document.getElementById('domainInput').value = '';
  document.getElementById('objectiveInput').value = '';
  document.getElementById('companyInput').focus();
  currentData = null;
}

const loadingMessages = [
  'Querying web sources via Exa Neural Search...',
  'Scanning company overview and products...',
  'Analyzing funding rounds and growth signals...',
  'Identifying leadership team and decision makers...',
  'Synthesizing intelligence report with AI...',
  'Structuring findings and assigning confidence...',
  'Finalizing GTM opportunity analysis...',
];
let loadingInterval = null;

function startLoadingAnimation() {
  let idx = 0;
  const stepsEl = document.getElementById('loadingSteps');
  const progressBar = document.getElementById('progressBar');
  
  progressBar.style.animation = 'none';
  progressBar.offsetHeight;
  progressBar.style.animation = 'progress-grow 18s ease-out forwards';
  
  stepsEl.textContent = loadingMessages[0];
  loadingInterval = setInterval(() => {
    idx = (idx + 1) % loadingMessages.length;
    stepsEl.textContent = loadingMessages[idx];
  }, 2500);
}

function stopLoadingAnimation() {
  if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
  }
}

async function executeResearch() {
  const companyName = document.getElementById('companyInput').value.trim();
  const website = document.getElementById('domainInput').value.trim();
  const objective = document.getElementById('objectiveInput').value.trim();

  if (!companyName) {
    document.getElementById('companyInput').focus();
    document.getElementById('companyInput').style.borderColor = '#c53d5b';
    setTimeout(() => {
      document.getElementById('companyInput').style.borderColor = '';
    }, 2000);
    return;
  }

  const btn = document.getElementById('btnResearch');
  const btnText = document.getElementById('btnText');
  const loader = document.getElementById('loadingState');
  const results = document.getElementById('resultsSection');
  const hero = document.getElementById('heroSection');

  btn.disabled = true;
  btnText.textContent = 'Researching...';
  results.style.display = 'none';
  loader.style.display = 'block';
  startLoadingAnimation();

  loader.scrollIntoView({ behavior: 'smooth', block: 'center' });

  try {
    const response = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: companyName,
        website: website || null,
        reasearch_objective: objective || null,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const res = await response.json();
    currentData = res;

    stopLoadingAnimation();
    loader.style.display = 'none';

    if (res.success && res.data) {
      renderReport(res);
      hero.style.display = 'none';
      results.style.display = 'block';
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      const errors = (res.errors || []).join('\n');
      alert('Research returned no results.\n' + errors);
    }
  } catch (err) {
    stopLoadingAnimation();
    loader.style.display = 'none';
    alert(`Research failed: ${err.message}\n\nMake sure the backend is running on port 8000.`);
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Research Company';
  }
}

function renderReport(res) {
  const d = res.data;

  document.getElementById('resCompanyName').textContent = d.company_name || 'Unknown';
  document.getElementById('companyAvatar').textContent = (d.company_name || 'C')[0].toUpperCase();

  const webEl = document.getElementById('resWebsite');
  if (d.website) {
    const url = d.website.startsWith('http') ? d.website : `https://${d.website}`;
    webEl.href = url;
    webEl.textContent = d.website.replace(/^https?:\/\//, '').replace(/\/$/, '') + ' ↗';
    webEl.style.display = '';
  } else {
    webEl.style.display = 'none';
  }

  const indEl = document.getElementById('resIndustry');
  if (d.industry) {
    indEl.textContent = d.industry;
    indEl.style.display = '';
  } else {
    indEl.style.display = 'none';
  }

  document.getElementById('resDescription').textContent = d.company_description || 'No description available from research sources.';

  const empEl = document.getElementById('resEmployees');
  if (d.employee_size) {
    const srcLink = d.employee_size_source 
      ? ` <a href="${escapeHtml(d.employee_size_source)}" target="_blank" rel="noopener" style="font-size:0.72rem;color:var(--accent-blue);font-family:var(--font-mono);margin-left:4px;white-space:nowrap;">Source ↗</a>` 
      : '';
    empEl.innerHTML = `${escapeHtml(d.employee_size)}${srcLink}`;
  } else {
    empEl.textContent = 'Not available';
  }
  document.getElementById('resMarket').textContent = d.target_market || 'Not specified';
  document.getElementById('resFunding').textContent = d.funding_info || 'Not available';
  document.getElementById('resDuration').textContent = `${res.research_duration_seconds || '—'}s`;

  document.getElementById('resGtmOpportunity').textContent = d.potential_gtm_opportunity || 'No GTM opportunity analysis generated.';

  renderSignals(d.recent_growth_signals || []);

  renderLeaders(d.decision_makers || []);

  renderContacts(d.official_contact_pages || []);

  renderConfidence(d.field_confidence || {});

  renderFirmographics(d.firmographics || {});

  renderSources(d.source_urls || []);

  const providers = (res.providers_used || []).map(p => p.toUpperCase().replace('_', ' ')).join(' • ');
  document.getElementById('footerProviders').textContent = `Data Architecture: ${providers}`;
  document.getElementById('footerDuration').textContent = `Latency: ${res.research_duration_seconds}s`;
  document.getElementById('footerTimestamp').textContent = `Timestamp: ${new Date(res.timestamp).toLocaleString()}`;

  const warningsEl = document.getElementById('footerWarnings');
  warningsEl.innerHTML = '';
  (res.warnings || []).forEach(w => {
    const tag = document.createElement('span');
    tag.className = 'warning-tag';
    tag.textContent = '[Notice] ' + w;
    warningsEl.appendChild(tag);
  });
}

function renderSignals(signals) {
  const container = document.getElementById('resSignalsList');
  document.getElementById('signalCount').textContent = signals.length;
  container.innerHTML = '';

  if (signals.length === 0) {
    container.innerHTML = '<div class="empty-state">No growth signals detected in research data.</div>';
    return;
  }

  signals.forEach(s => {
    const div = document.createElement('div');
    div.className = 'signal-entry';
    div.setAttribute('data-type', s.signal_type || 'expansion');

    const dateStr = s.date ? formatDate(s.date) : 'Reported date unavailable';

    div.innerHTML = `
      <div class="signal-meta">
        <span class="signal-type-tag" data-type="${s.signal_type || 'expansion'}">${formatSignalType(s.signal_type)}</span>
        <span class="signal-date">${dateStr}</span>
      </div>
      <div class="signal-text">${escapeHtml(s.signal)}</div>
      ${s.source_url ? `<a class="signal-source" href="${escapeHtml(s.source_url)}" target="_blank" rel="noopener">View official source ↗</a>` : ''}
    `;
    container.appendChild(div);
  });
}

function renderLeaders(leaders) {
  const container = document.getElementById('resLeadersList');
  document.getElementById('leaderCount').textContent = leaders.length;
  container.innerHTML = '';

  if (leaders.length === 0) {
    container.innerHTML = '<div class="empty-state">No decision makers identified in research data.</div>';
    return;
  }

  leaders.forEach(m => {
    const div = document.createElement('div');
    div.className = 'person-card';
    div.innerHTML = `
      <div class="person-info">
        <div class="person-name">${escapeHtml(m.name)}</div>
        <div class="person-role">${escapeHtml(m.role || 'Executive')}</div>
      </div>
      ${m.source_url ? `<a class="person-link" href="${escapeHtml(m.source_url)}" target="_blank" rel="noopener">Source ↗</a>` : ''}
    `;
    container.appendChild(div);
  });
}

function renderContacts(contacts) {
  const card = document.getElementById('contactCard');
  const container = document.getElementById('resContactInfo');
  container.innerHTML = '';

  if (!contacts || contacts.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = '';
  contacts.forEach(c => {
    if (!c) return;
    const item = typeof c === 'string' ? c.trim() : JSON.stringify(c);
    if (!item) return;

    if (item.startsWith('http://') || item.startsWith('https://')) {
      const a = document.createElement('a');
      a.className = 'contact-item';
      a.href = item;
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;display:inline-block;vertical-align:middle;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>${escapeHtml(item)} ↗`;
      container.appendChild(a);
    } else if (item.includes('@') && !item.includes(' ')) {
      const a = document.createElement('a');
      a.className = 'contact-item';
      a.href = `mailto:${item}`;
      a.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;display:inline-block;vertical-align:middle;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>${escapeHtml(item)}`;
      container.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.className = 'contact-item';
      span.textContent = item;
      container.appendChild(span);
    }
  });
}

function renderConfidence(confidence) {
  const container = document.getElementById('resConfidence');
  container.innerHTML = '';

  const fieldLabels = {
    company_name: 'Company Name',
    website: 'Website',
    company_description: 'Description',
    industry: 'Industry',
    target_market: 'Target Market',
    employee_size: 'Employee Size',
    funding_info: 'Valuation & Funding',
    recent_growth_signals: 'Growth Signals',
    potential_gtm_opportunity: 'GTM Opportunity',
    decision_makers: 'Decision Makers',
    official_contact_pages: 'Official Contact Pages',
    headquarters: 'Headquarters',
    company_type: 'Company Type',
    business_model: 'Business Model',
    technologies: 'Detected Tech Stack',
    firmographics: 'Firmographic Data',
  };

  for (const [field, level] of Object.entries(confidence)) {
    if (field === 'ai_synthesis' || field === 'note') continue;
    
    const div = document.createElement('div');
    div.className = 'confidence-item';
    
    const label = fieldLabels[field] || field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const badgeClass = level.includes('verified') ? 'verified' 
                     : level.includes('inferred') ? 'inferred'
                     : level.includes('provider') ? 'provider-reported'
                     : level.includes('unavailable') ? 'unavailable'
                     : 'inferred';
    
    div.innerHTML = `
      <span class="confidence-field">${escapeHtml(label)}</span>
      <span class="confidence-badge ${badgeClass}">${escapeHtml(level)}</span>
    `;
    container.appendChild(div);
  }
}

function formatSourceLink(src) {
  if (!src) return '';
  const str = String(src).trim();
  if (str.startsWith('http://') || str.startsWith('https://')) {
    const domain = extractDomain(str);
    return `<a class="firmo-source-link" href="${escapeHtml(str)}" target="_blank" rel="noopener">${escapeHtml(domain)} ↗</a>`;
  }
  const urlMatch = str.match(/https?:\/\/[^\s\)]+/);
  if (urlMatch) {
    const cleanLabel = str.replace(urlMatch[0], '').replace(/[()·•\-]/g, '').trim() || extractDomain(urlMatch[0]);
    return `<a class="firmo-source-link" href="${escapeHtml(urlMatch[0])}" target="_blank" rel="noopener">${escapeHtml(cleanLabel)} ↗</a>`;
  }
  return `<span>${escapeHtml(str)}</span>`;
}

function renderFirmographics(firmo) {
  const card = document.getElementById('firmographicsCard');
  if (!firmo || Object.keys(firmo).length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  const UNAVAILABLE = '<span style="color:var(--text-muted);font-style:italic;">Unavailable</span>';

  const hqEl = document.getElementById('firmoHQ');
  const hqSub = document.getElementById('firmoHQSub');
  if (firmo.headquarters) {
    hqEl.textContent = firmo.headquarters;
    const conf = firmo.headquarters_confidence || 'verified';
    const src = firmo.headquarters_source || 'Official Company Newsroom';
    hqSub.innerHTML = `Source: ${formatSourceLink(src)} <span class="firmo-badge ${conf}">${escapeHtml(conf)}</span>`;
  } else {
    hqEl.innerHTML = UNAVAILABLE;
    hqSub.innerHTML = '<span style="color:var(--text-muted);font-size:0.7rem;">Not substantiated by available sources</span>';
  }

  const typeEl = document.getElementById('firmoType');
  const typeSub = document.getElementById('firmoTypeSub');
  if (firmo.company_type) {
    typeEl.textContent = firmo.company_type;
    const conf = firmo.company_type_confidence || 'verified';
    const src = firmo.company_type_source || 'Authoritative Reporting';
    typeSub.innerHTML = `Source: ${formatSourceLink(src)} <span class="firmo-badge ${conf}">${escapeHtml(conf)}</span>`;
  } else {
    typeEl.innerHTML = UNAVAILABLE;
    typeSub.innerHTML = '<span style="color:var(--text-muted);font-size:0.7rem;">Not substantiated by available sources</span>';
  }

  const modelEl = document.getElementById('firmoModel');
  const modelSub = document.getElementById('firmoModelSub');
  if (firmo.business_model) {
    modelEl.textContent = firmo.business_model;
    const conf = firmo.business_model_confidence || 'verified';
    const src = firmo.business_model_source || 'Official Website';
    modelSub.innerHTML = `Source: ${formatSourceLink(src)} <span class="firmo-badge ${conf}">${escapeHtml(conf)}</span>`;
  } else {
    modelEl.innerHTML = UNAVAILABLE;
    modelSub.innerHTML = '<span style="color:var(--text-muted);font-size:0.7rem;">Not substantiated by available sources</span>';
  }

  const techContainer = document.getElementById('firmoTech');
  const techSub = document.getElementById('firmoTechSub');
  techContainer.innerHTML = '';
  const techs = firmo.technologies || [];
  if (Array.isArray(techs) && techs.length > 0) {
    techs.forEach(t => {
      const pill = document.createElement('span');
      pill.className = 'tech-pill';
      pill.textContent = t;
      techContainer.appendChild(pill);
    });
    const conf = firmo.technologies_confidence || 'inferred';
    const src = firmo.technologies_source || 'Public engineering publications & careers';
    techSub.innerHTML = `Source: ${formatSourceLink(src)} <span class="firmo-badge ${conf}">${escapeHtml(conf)}</span>`;
  } else {
    techContainer.innerHTML = UNAVAILABLE;
    techSub.innerHTML = '<span style="color:var(--text-muted);font-size:0.7rem;">No verified technologies in analyzed sources</span>';
  }

  const sourceBadge = document.getElementById('firmoSourceBadge');
  if (sourceBadge) {
    sourceBadge.textContent = firmo.source_provider || 'Public company research · Exa';
  }

  const noticeTitle = document.getElementById('moldsetNoticeTitle');
  const noticeBody = document.getElementById('moldsetNoticeBody');
  const noticeBanner = document.getElementById('firmoMoldsetNotice');
  if (firmo.moldset_configured) {
    noticeTitle.textContent = 'Moldset Live Enrichment Active';
    noticeBody.textContent = 'Proprietary enrichment data merged with public web research.';
    noticeBanner.style.borderColor = 'rgba(42, 67, 101, 0.3)';
    noticeBanner.style.background = 'rgba(42, 67, 101, 0.04)';
  } else {
    noticeTitle.textContent = 'Moldset enrichment unavailable';
    noticeBody.textContent = firmo.enrichment_notice || "API credentials aren't configured. Publicly available information is still shown; proprietary enrichment fields remain unavailable.";
    noticeBanner.style.borderColor = 'var(--border-light)';
    noticeBanner.style.background = 'rgba(0, 0, 0, 0.02)';
  }
}

function renderSources(sources) {
  const container = document.getElementById('resSourcesList');
  document.getElementById('sourceCount').textContent = sources.length;
  container.innerHTML = '';

  if (sources.length === 0) {
    container.innerHTML = '<div class="empty-state">No source citations available.</div>';
    return;
  }

  sources.forEach(src => {
    const div = document.createElement('div');
    div.className = 'source-card';
    
    const domain = src.domain || extractDomain(src.url);
    const displayTitle = src.title || domain;
    const rawSnippet = src.snippet ? cleanMarkdown(src.snippet) : 'Primary research evidence analyzed.';
    const snippet = truncateText(rawSnippet, 160);
    const dateStr = src.published_date ? formatDate(src.published_date) : '';

    div.innerHTML = `
      <div>
        <div class="source-card-top">
          <span class="source-domain-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:2px;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            ${escapeHtml(domain)}
          </span>
          <a class="source-ext-link" href="${escapeHtml(src.url)}" target="_blank" rel="noopener">
            <span>Source</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        </div>
        <a class="source-title" href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${escapeHtml(displayTitle)}</a>
        <div class="source-snippet">${escapeHtml(snippet)}</div>
      </div>
      <div class="source-card-bottom">
        <span>${dateStr ? `Published: ${dateStr}` : 'Research Evidence'}</span>
        <span style="color: var(--text-muted); font-weight: 500;">↗ View Source</span>
      </div>
    `;
    container.appendChild(div);
  });
}

function exportJSON() {
  if (!currentData) return;
  const blob = new Blob([JSON.stringify(currentData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(currentData.data?.company_name || 'company').toLowerCase().replace(/\s+/g, '_')}_intelligence_report.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncateText(text, max) {
  if (!text) return '';
  return text.length > max ? text.substring(0, max) + '…' : text;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    if (/^\d{4}-\d{2}$/.test(dateStr)) {
      const [year, month] = dateStr.split('-');
      const d = new Date(parseInt(year), parseInt(month) - 1);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.slice(0, 10);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr.slice(0, 10);
  }
}

function formatSignalType(type) {
  if (!type) return 'SIGNAL';
  return type.replace(/_/g, ' ').toUpperCase();
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function cleanMarkdown(text) {
  if (!text) return '';
  return text.replace(/^[#>\s*•\-]+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').trim();
}
