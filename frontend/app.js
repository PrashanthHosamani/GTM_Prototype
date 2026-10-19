const $ = id => document.getElementById(id);
const esc = s => s ? String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '';

let currentData = null;
let currentProspectSheet = null;
let currentSelectedHook = '';

document.addEventListener('DOMContentLoaded', () => {
  ['companyInput', 'domainInput', 'objectiveInput'].forEach(id => {
    $(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); executeResearch(); }
    });
  });

  $('prospectInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleProspectSubmit(e); }
  });

  const urlParams = new URLSearchParams(window.location.search);
  const viewParam = urlParams.get('view');
  const compParam = urlParams.get('company');
  const domParam = urlParams.get('domain') || '';
  const autoParam = urlParams.get('auto');

  if (viewParam === 'deep' || compParam) {
    switchPlatformMode('deep');
    if (compParam) {
      $('companyInput').value = compParam;
      $('domainInput').value = domParam;
      if (autoParam === '1' || autoParam === 'true') {
        $('heroSection').style.display = 'none';
        $('resultsSection').style.display = 'none';
        $('loadingSection').style.display = 'block';
        startLoadingAnimation();
        executeResearch();
      }
    }
  } else {
    fetchInitialProspectSheet();
  }
});

function switchPlatformMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.platform-view').forEach(v => v.classList.remove('active'));
  if (mode === 'prompt') {
    $('tabPromptMode').classList.add('active');
    $('viewPrompt').classList.add('active');
  } else {
    $('tabDeepMode').classList.add('active');
    $('viewDeep').classList.add('active');
  }
}

async function fetchInitialProspectSheet() {
  try {
    const res = await fetch('/api/prospect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Find 10 B2B SaaS companies with 50-500 employees that use HubSpot or Salesforce' })
    });
    if (res.ok) {
      currentProspectSheet = await res.json();
      renderProspectSheet(currentProspectSheet);
    }
  } catch (err) {
    console.error('Initial sheet error:', err);
  }
}

function useQuickPrompt(text) {
  if ($('prospectInput')) {
    $('prospectInput').value = text;
    handleProspectSubmit();
  }
}

async function handleProspectSubmit(e) {
  if (e) e.preventDefault();
  const input = $('prospectInput');
  const prompt = input.value.trim();
  if (!prompt) return;

  const chips = document.querySelector('.prompt-chips');
  if (chips) chips.style.display = 'none';

  appendChatMessage('user', prompt);
  input.value = '';

  const stream = $('chatStream');
  const thinkMsg = document.createElement('div');
  thinkMsg.className = 'chat-message assistant-message thinking-bubble-msg';
  thinkMsg.innerHTML = `
    <div class="msg-avatar">O</div>
    <div class="msg-body thinking-body">
      <div class="thinking-header-row">
        <span class="thinking-spinner-icon"></span>
        <span class="thinking-status-label">Agent Thinking & Searching...</span>
      </div>
      <div class="thinking-live-log" id="thinkingLiveLog">
        <div class="log-line log-active">&bull; Deconstructing ICP criteria from prompt...</div>
      </div>
    </div>
  `;
  stream.appendChild(thinkMsg);
  stream.scrollTop = stream.scrollHeight;

  const logSteps = [
    { text: 'Deconstructed prompt: Target ICP & filter parameters', delay: 400 },
    { text: 'Querying live web via Exa neural search...', delay: 1100 },
    { text: 'Discovered candidate companies across active disclosures', delay: 1900 },
    { text: 'Analyzing verified tech stacks & headcount bands...', delay: 2700 },
    { text: 'Synthesizing dynamic columns & cold outreach angles...', delay: 3500 }
  ];

  const logContainer = thinkMsg.querySelector('#thinkingLiveLog');
  const timeouts = [];
  logSteps.forEach((s, i) => {
    const t = setTimeout(() => {
      const prev = logContainer.querySelector('.log-active');
      if (prev) {
        prev.className = 'log-line log-done';
        prev.innerHTML = `&#10003; ${prev.textContent.replace(/^[\u2022\s]+/, '')}`;
      }
      const line = document.createElement('div');
      line.className = 'log-line log-active';
      line.innerHTML = `&bull; ${s.text}`;
      logContainer.appendChild(line);
      stream.scrollTop = stream.scrollHeight;
    }, s.delay);
    timeouts.push(t);
  });

  const loading = $('sheetLoadingIndicator');
  loading.style.display = 'flex';
  $('sheetLoadingText').textContent = 'Searching live web via Exa neural queries...';

  const tbody = $('tableBody');
  tbody.innerHTML = [1, 2, 3, 4, 5, 6].map(i => `
    <tr class="skeleton-row">
      <td style="color:#94a3b8;font-weight:500;">${i}</td>
      <td><div class="skeleton-bar w-50"></div></td>
      <td><div class="skeleton-bar w-70"></div></td>
      <td><div class="skeleton-bar w-60"></div></td>
      <td><div class="skeleton-bar w-80"></div></td>
      <td><div class="skeleton-bar"></div></td>
      <td><div class="skeleton-bar w-70"></div></td>
    </tr>
  `).join('');

  const isFollowup = currentProspectSheet?.rows?.length > 0;
  const endpoint = isFollowup ? '/api/prospect/followup' : '/api/prospect';
  const payload = isFollowup
    ? { prompt, current_columns: currentProspectSheet.columns, current_rows: currentProspectSheet.rows }
    : { prompt };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(res.statusText);
    currentProspectSheet = await res.json();

    timeouts.forEach(clearTimeout);
    const lastActive = logContainer.querySelector('.log-active');
    if (lastActive) {
      lastActive.className = 'log-line log-done';
      lastActive.innerHTML = `&#10003; ${lastActive.textContent.replace(/^[\u2022\s]+/, '')}`;
    }
    const finalDone = document.createElement('div');
    finalDone.className = 'log-line log-done';
    finalDone.innerHTML = `&#10003; Assembled ${currentProspectSheet.rows.length}-row dynamic spreadsheet`;
    logContainer.appendChild(finalDone);

    thinkMsg.querySelector('.thinking-status-label').textContent = 'Discovery & Extraction Complete';
    thinkMsg.querySelector('.thinking-spinner-icon').style.display = 'none';

    renderProspectSheet(currentProspectSheet);
    appendChatMessage('assistant', currentProspectSheet.summary || `Updated sheet with ${currentProspectSheet.rows.length} prospects.`);
  } catch (err) {
    timeouts.forEach(clearTimeout);
    appendChatMessage('assistant', `Failed to update sheet: ${err.message}`);
  } finally {
    loading.style.display = 'none';
  }
}

function formatMarkdown(text) {
  if (!text) return '';
  let html = esc(text);
  html = html.replace(/^### (.*$)/gim, '<h4 class="chat-subhead">$1</h4>');
  html = html.replace(/^## (.*$)/gim, '<h3 class="chat-head">$1</h3>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/^\s*[-•]\s+(.*$)/gim, '<li class="chat-bullet">$1</li>');
  html = html.replace(/(<li class="chat-bullet">.*?<\/li>(?:\s*<li class="chat-bullet">.*?<\/li>)*)/gs, '<ul class="chat-list">$1</ul>');
  html = html.replace(/^\d+\.\s+(.*$)/gim, '<li class="chat-bullet-num">$1</li>');
  return html.split('\n\n').map(p => {
    p = p.trim();
    if (!p) return '';
    if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<li')) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

function appendChatMessage(role, text) {
  const stream = $('chatStream');
  const msg = document.createElement('div');
  msg.className = `chat-message ${role}-message`;
  const bodyContent = role === 'assistant' ? formatMarkdown(text) : `<p>${esc(text)}</p>`;
  msg.innerHTML = `<div class="msg-avatar">${role === 'user' ? 'U' : 'O'}</div><div class="msg-body">${bodyContent}</div>`;
  stream.appendChild(msg);
  stream.scrollTop = stream.scrollHeight;
}

function renderProspectSheet(data) {
  $('sheetTitle').textContent = data.title || 'Prospect Sheet';
  $('rowCountBadge').textContent = `${data.rows.length} Rows`;

  const headers = ['#', ...data.columns.map(c => esc(c.label)), 'Actions'];
  $('tableHead').innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;

  $('tableBody').innerHTML = data.rows.map((row, idx) => {
    const cells = data.columns.map(col => {
      const val = row[col.key] || '—';
      if (col.key === 'fit_score') {
        const score = parseInt(val) || 90;
        return `<td><span class="fit-badge ${score >= 90 ? 'high' : 'medium'}">${score} &gt;</span></td>`;
      }
      if (col.key === 'company_name') {
        return `<td><div class="company-cell"><div class="company-cell-icon">${esc(val[0]?.toUpperCase() || 'C')}</div><span>${esc(val)}</span></div></td>`;
      }
      if (col.key === 'domain') {
        const d = String(val).replace(/^https?:\/\//, '').replace(/\/$/, '');
        return `<td><a href="https://${d}" target="_blank" class="cell-link">${esc(d)}</a></td>`;
      }
      if (col.type === 'badge' || col.key === 'crm_platform') {
        const cls = String(val).toLowerCase().includes('hubspot') ? 'hubspot' : String(val).toLowerCase().includes('salesforce') ? 'salesforce' : '';
        return `<td><span class="cell-pill ${cls}">${esc(val)}</span></td>`;
      }
      if (col.type === 'link' || (typeof val === 'string' && val.startsWith('http'))) {
        let label = 'Proof';
        try { label = new URL(val).hostname; } catch {}
        return `<td><a href="${esc(val)}" target="_blank" class="cell-link">${esc(label)} &nearr;</a></td>`;
      }
      return `<td>${esc(val)}</td>`;
    }).join('');

    const comp = esc(row.company_name || '');
    const dom = esc(row.domain || '');
    const hook = esc(row.outreach_hook || `Outreach trigger for ${comp}`);

    const actions = `<td><div class="action-btn-group">
      <button class="btn-table-drill" onclick="runDeepResearchFromProspect('${comp}', '${dom}')">Deep Research &rarr;</button>
      <button class="btn-table-hook" onclick="showHookModal('${comp}', '${hook.replace(/'/g, "\\'")}')">Outreach Hook</button>
    </div></td>`;

    return `<tr><td style="color:#94a3b8;font-weight:500;">${idx + 1}</td>${cells}${actions}</tr>`;
  }).join('');

  $('summaryViewText').innerHTML = formatMarkdown(data.summary || '');
  $('followupChipsList').innerHTML = (data.suggested_followups || []).map(f => `<button class="chip-followup" onclick="useQuickPrompt('${esc(f)}')">${esc(f)}</button>`).join('');
}

function toggleSheetView(view) {
  const isSheet = view === 'sheet';
  $('btnTabSheet').classList.toggle('active', isSheet);
  $('btnTabSummary').classList.toggle('active', !isSheet);
  $('sheetViewContainer').style.display = isSheet ? 'block' : 'none';
  $('summaryViewContainer').style.display = isSheet ? 'none' : 'block';
}

function runDeepResearchFromProspect(comp, dom) {
  const url = `/?view=deep&company=${encodeURIComponent(comp)}&domain=${encodeURIComponent(dom)}&auto=1`;
  const win = window.open(url, '_blank');
  if (!win || win.closed || typeof win.closed === 'undefined') {
    window.location.href = url;
  }
}

function showHookModal(comp, hook) {
  currentSelectedHook = hook;
  $('modalHookTitle').textContent = `Outreach Hook · ${comp}`;
  $('modalHookContent').textContent = hook;
  $('hookModal').style.display = 'flex';
}

function closeHookModal(e) {
  if (e && e.target !== e.currentTarget && !e.target.classList.contains('modal-close')) return;
  $('hookModal').style.display = 'none';
}

function copyHookToClipboard() {
  if (!currentSelectedHook) return;
  navigator.clipboard.writeText(currentSelectedHook).then(() => {
    const btn = document.querySelector('#hookModal .btn-action-primary');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

function exportTableToCsv() {
  if (!currentProspectSheet?.rows?.length) return;
  const cols = currentProspectSheet.columns;
  const headers = cols.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',');
  const rows = currentProspectSheet.rows.map(r => cols.map(c => `"${String(r[c.key] || '').replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([[headers, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(currentProspectSheet.title || 'prospects').toLowerCase().replace(/\s+/g, '_')}.csv`;
  a.click();
}

function copyTableForSheets() {
  if (!currentProspectSheet?.rows?.length) return;
  const cols = currentProspectSheet.columns;
  const headers = cols.map(c => c.label).join('\t');
  const rows = currentProspectSheet.rows.map(r => cols.map(c => String(r[c.key] || '').replace(/\t/g, ' ')).join('\t')).join('\n');
  navigator.clipboard.writeText(`${headers}\n${rows}`).then(() => {
    const btn = document.querySelector('.btn-action-outline');
    const orig = btn.textContent;
    btn.textContent = 'Copied to Clipboard!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

function setCompany(name, domain) {
  $('companyInput').value = name;
  $('domainInput').value = domain;
  $('heroSection').style.display = 'none';
  executeResearch();
}

function newSearch() {
  $('resultsSection').style.display = 'none';
  $('loadingSection').style.display = 'none';
  $('heroSection').style.display = 'block';
  $('companyInput').value = '';
  $('domainInput').value = '';
  $('objectiveInput').value = '';
  $('companyInput').focus();
  currentData = null;
}

let loadingInterval = null;
function startLoadingAnimation() {
  const messages = ['Exa neural search active...', 'Discovering verified company facts...', 'Synthesizing with Gemini failover pool...', 'Finalizing 12-field dossier...'];
  let idx = 0;
  $('progressBar').style.animation = 'none';
  $('progressBar').offsetHeight;
  $('progressBar').style.animation = 'progress-grow 18s ease-out forwards';
  $('loadingSteps').textContent = messages[0];
  loadingInterval = setInterval(() => { idx = (idx + 1) % messages.length; $('loadingSteps').textContent = messages[idx]; }, 2500);
}

function stopLoadingAnimation() {
  if (loadingInterval) { clearInterval(loadingInterval); loadingInterval = null; }
}

async function executeResearch() {
  const name = $('companyInput').value.trim();
  const website = $('domainInput').value.trim();
  const objective = $('objectiveInput').value.trim();
  if (!name) { $('companyInput').focus(); return; }

  const btn = $('btnResearch');
  if (btn) btn.disabled = true;
  $('heroSection').style.display = 'none';
  $('resultsSection').style.display = 'none';
  $('loadingSection').style.display = 'block';
  startLoadingAnimation();

  try {
    const res = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, website: website || null, reasearch_objective: objective || null })
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    currentData = json;
    stopLoadingAnimation();
    $('loadingSection').style.display = 'none';
    if (json.success && json.data) {
      renderReport(json);
      $('heroSection').style.display = 'none';
      $('resultsSection').style.display = 'block';
    } else {
      alert((json.errors || []).join('\n') || 'No data found');
    }
  } catch (err) {
    stopLoadingAnimation();
    $('loadingSection').style.display = 'none';
    alert(`Research error: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

function renderReport(res) {
  const d = res.data;
  $('resCompanyName').textContent = d.company_name || 'Unknown';
  $('resWebsiteText').textContent = d.website ? d.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : '—';
  $('resCompanyWebsite').href = d.website ? (d.website.startsWith('http') ? d.website : `https://${d.website}`) : '#';
  $('resIndustry').textContent = d.industry || '—';
  $('resHeadquarters').textContent = d.firmographics?.headquarters || '—';
  $('resDescription').textContent = d.company_description || 'No description available.';
  $('resEmployeeSize').textContent = d.employee_size || 'Not available';
  $('resFundingInfo').textContent = d.funding_info || 'Not available';
  $('resTargetMarket').textContent = d.target_market || 'Not specified';
  $('resGtmOpportunity').textContent = d.potential_gtm_opportunity || 'No GTM opportunity generated.';

  $('resDecisionMakers').innerHTML = (d.decision_makers || []).map(m => `
    <div class="leader-card">
      <div class="leader-name">${esc(m.name)}</div>
      <div class="leader-role">${esc(m.role || 'Executive')}</div>
      ${m.source_url ? `<a href="${esc(m.source_url)}" target="_blank" class="leader-link">Profile ↗</a>` : ''}
    </div>
  `).join('') || '<div class="empty-state">No active decision makers surfaced.</div>';

  $('resGrowthSignals').innerHTML = (d.recent_growth_signals || []).map(s => `
    <div class="signal-item">
      <div class="signal-title">${esc(s.headline)}</div>
      <div class="signal-desc">${esc(s.description)}</div>
      ${s.source_url ? `<a href="${esc(s.source_url)}" target="_blank" class="cell-link">Evidence ↗</a>` : ''}
    </div>
  `).join('') || '<div class="empty-state">No recent growth signals found.</div>';

  $('resFirmographics').innerHTML = `
    <div class="firmo-row"><strong>Business Model:</strong> <span>${esc(d.firmographics?.business_model || '—')}</span></div>
    <div class="firmo-row"><strong>Tech Disclosures:</strong> <span>${(d.firmographics?.technologies || []).map(t => `<span class="cell-pill">${esc(t)}</span>`).join(' ') || 'Not publicly documented'}</span></div>
    ${d.firmographics?.moldset_notice ? `<div class="warning-tag">${esc(d.firmographics.moldset_notice)}</div>` : ''}
  `;

  $('sourceCount').textContent = (d.source_urls || []).length;
  $('resSourcesList').innerHTML = (d.source_urls || []).map(s => `
    <div class="source-card">
      <a href="${esc(s.url)}" target="_blank" class="source-title">${esc(s.title || s.url)} ↗</a>
      <p class="source-snippet">${esc(s.snippet || '')}</p>
    </div>
  `).join('');

  $('footerProviders').textContent = `Providers: ${(res.providers_used || []).join(', ').toUpperCase()}`;
  $('footerDuration').textContent = `Duration: ${res.research_duration_seconds}s`;
  $('footerTimestamp').textContent = `Generated: ${new Date(res.timestamp).toLocaleTimeString()}`;
}

function exportJSON() {
  if (!currentData) return;
  const blob = new Blob([JSON.stringify(currentData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(currentData.data?.company_name || 'company').toLowerCase().replace(/\s+/g, '_')}_dossier.json`;
  a.click();
}
