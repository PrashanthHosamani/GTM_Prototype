const $ = id => document.getElementById(id);
const esc = s => s ? String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '';

let currentData = null;
let currentProspectSheet = null;
let currentSelectedHook = '';
let currentSessionId = localStorage.getItem('outmate_active_session_id') || ('session_' + Date.now());

document.addEventListener('DOMContentLoaded', () => {
  ['companyInput', 'domainInput', 'objectiveInput'].forEach(id => {
    $(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); executeResearch(); }
    });
  });

  $('prospectInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleProspectSubmit(e); }
  });

  const streamEl = $('chatStream');
  if (streamEl) {
    streamEl.addEventListener('scroll', () => {
      if (streamEl.scrollLeft !== 0) streamEl.scrollLeft = 0;
    }, { passive: true });
    streamEl.addEventListener('wheel', e => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const allowedList = e.target.closest('.chat-followups-container, .chat-table-wrapper');
        if (!allowedList) {
          streamEl.scrollLeft = 0;
        }
      }
    }, { passive: true });
  }

  updateHistoryBadge();
  initRouteFromUrl(false);
});

window.addEventListener('popstate', () => {
  initRouteFromUrl(false);
});

function initRouteFromUrl(push = true) {
  const urlParams = new URLSearchParams(window.location.search);
  const path = window.location.pathname;
  const viewParam = urlParams.get('view');
  const compParam = urlParams.get('company');
  const domParam = urlParams.get('domain') || '';
  const autoParam = urlParams.get('auto');

  if (viewParam === 'deep' || path === '/deep' || compParam) {
    navigateTo('deep', compParam ? { company: compParam, domain: domParam, auto: autoParam === '1' } : {}, push);
  } else if (viewParam === 'prospect' || path === '/prospect') {
    navigateTo('prospect', {}, push);
  } else {
    navigateTo('home', {}, push);
  }
}

function navigateTo(view, params = {}, push = true) {
  document.querySelectorAll('.platform-view').forEach(v => v.classList.remove('active'));
  const navCtx = $('navContext');
  const navLabel = $('navPageLabel');

  if (view === 'prospect') {
    $('viewPrompt').classList.add('active');
    if (navCtx) navCtx.style.display = 'flex';
    if (navLabel) navLabel.textContent = 'Prompt Prospector';
    if (push) history.pushState(null, '', '/?view=prospect');
    if (!currentProspectSheet) {
      initProspectView();
    }
  } else if (view === 'deep') {
    $('viewDeep').classList.add('active');
    if (navCtx) navCtx.style.display = 'flex';
    if (navLabel) navLabel.textContent = 'Company Intelligence Dossier';
    if (params.company) {
      $('companyInput').value = params.company;
      $('domainInput').value = params.domain || '';
      $('heroSection').style.display = 'none';
      $('resultsSection').style.display = 'none';
      $('loadingState').style.display = 'block';
      if (push) history.pushState(null, '', `/?view=deep&company=${encodeURIComponent(params.company)}&domain=${encodeURIComponent(params.domain || '')}&auto=1`);
      startLoadingAnimation();
      executeResearch();
    } else {
      if (push) history.pushState(null, '', '/?view=deep');
      if (!currentData) {
        newSearch();
      }
    }
  } else {
    $('viewHome').classList.add('active');
    if (navCtx) navCtx.style.display = 'none';
    if (push) history.pushState(null, '', '/');
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function initProspectView() {
  const savedSessionId = localStorage.getItem('outmate_active_session_id');
  if (savedSessionId) {
    try {
      const res = await fetch(`/api/prospect/session/${encodeURIComponent(savedSessionId)}`);
      if (res.ok) {
        const data = await res.json();
        currentSessionId = data.session_id;
        const stream = $('chatStream');
        if (stream && data.messages && data.messages.length > 0) {
          stream.innerHTML = '';
          data.messages.forEach(msg => {
            appendChatMessage(msg.role, msg.content);
          });
        }
        if (data.sheet && data.sheet.rows && data.sheet.rows.length > 0) {
          currentProspectSheet = data.sheet;
          renderProspectSheet(currentProspectSheet);
          const chips = document.querySelector('.prompt-chips');
          if (chips) chips.style.display = 'none';
          return;
        }
      }
    } catch (e) {
    }
  }
  startNewProspectSearch();
}

function startNewProspectSearch() {
  currentProspectSheet = null;
  currentSessionId = 'session_' + Date.now();
  localStorage.setItem('outmate_active_session_id', currentSessionId);
  const stream = $('chatStream');
  if (stream) {
    stream.innerHTML = '';
    appendChatMessage('assistant', 'Starting a new search. Describe the target companies or people you want to find.');
  }
  const thead = $('tableHead');
  if (thead) thead.innerHTML = '';
  const tbody = $('tableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:64px 16px;color:#64748b;font-size:0.9rem;">No prospects loaded yet. Enter a prompt below or select a quick prompt to begin.</td></tr>';
  }
  $('sheetTitle').textContent = 'Prospect Sheet';
  $('rowCountBadge').textContent = '0 Rows';
  const footerRowEl = $('sheetFooterRowCount');
  if (footerRowEl) footerRowEl.textContent = 'Rows: 0';
  toggleSheetView('sheet');
  const chips = document.querySelector('.prompt-chips');
  if (chips) chips.style.display = 'flex';
  if ($('prospectInput')) {
    $('prospectInput').value = '';
    $('prospectInput').focus();
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
  stream.scrollLeft = 0;

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

  const pLower = prompt.trim().toLowerCase();
  const hasCurrentSheet = Boolean(currentProspectSheet && currentProspectSheet.rows && currentProspectSheet.rows.length > 0);
  const isExplicitReset = pLower.startsWith('new search') || pLower.startsWith('start over') || pLower.startsWith('reset') || pLower.startsWith('clear');
  
  const mentionsPriorContext = [
    'these', 'this', 'same', 'the', 'their', 'them', 'of those', 'of the',
    'founder', 'founders', 'ceo', 'contact', 'contacts', 'decision maker', 'revops',
    'email', 'phone', 'linkedin', 'filter', 'sort', 'only', 'salesforce', 'hubspot',
    'column', 'remove', 'add', 'update', 'verify', 'show all', 'who', 'list out', 'list', 'show', 'vp', 'director'
  ].some(w => pLower.includes(w));

  const isBrandNewDiscovery = !mentionsPriorContext && Boolean(
    pLower.match(/^(?:find|discover|search|give me|get)\s+\d+\s+(?:b2b|saas|companies|startups|accounts|leads)/i)
  );

  if (!currentSessionId) {
    currentSessionId = 'session_' + Date.now();
    localStorage.setItem('outmate_active_session_id', currentSessionId);
  }

  const isFollowup = hasCurrentSheet && !isExplicitReset && !isBrandNewDiscovery;
  const endpoint = isFollowup ? '/api/prospect/followup' : '/api/prospect';
  const payload = isFollowup
    ? { prompt, session_id: currentSessionId, current_columns: currentProspectSheet.columns, current_rows: currentProspectSheet.rows }
    : { prompt, session_id: currentSessionId };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(res.statusText);
    currentProspectSheet = await res.json();
    if (currentProspectSheet.session_id) {
      currentSessionId = currentProspectSheet.session_id;
      localStorage.setItem('outmate_active_session_id', currentSessionId);
    }

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
    saveSearchToHistory(currentProspectSheet, prompt);
    appendChatMessage(
      'assistant',
      currentProspectSheet.summary || `Updated sheet with ${currentProspectSheet.rows.length} prospects.`,
      currentProspectSheet.suggested_followups || [],
      currentProspectSheet.clarification_question
    );
  } catch (err) {
    timeouts.forEach(clearTimeout);
    appendChatMessage('assistant', `Failed to update sheet: ${err.message}`);
  } finally {
    loading.style.display = 'none';
  }
}

function renderClarificationCard(card) {
  if (!card || !card.options) return '';
  return `
    <div class="clarification-card">
      <div class="clarification-tag"><span class="clarification-tag-icon">&#9670;</span> ${esc(card.tag || 'QUESTION')}</div>
      <div class="clarification-prompt">${esc(card.question)}</div>
      <div class="clarification-options">
        ${card.options.map(opt => `
          <button class="clarification-option-btn" onclick="useQuickPrompt('${esc(opt.title)}')">
            <span class="clarification-num">${esc(opt.number)}</span>
            <div class="clarification-opt-text">
              <span class="clarification-opt-title">${esc(opt.title)}</span>
              ${opt.description ? `<span class="clarification-opt-desc">${esc(opt.description)}</span>` : ''}
            </div>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function formatMarkdown(text) {
  if (!text) return '';
  let html = esc(text);

  html = html.replace(/(?:^|\n)((?:\|[^\n]+\|\r?\n?)+)/g, (match, tableBlock) => {
    const lines = tableBlock.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return match;
    const parseRow = (line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const headerCols = parseRow(lines[0]);
    let startIdx = 1;
    if (lines[1] && (lines[1].includes('---') || lines[1].includes(':---'))) {
      startIdx = 2;
    }
    const ths = headerCols.map(h => `<th>${h}</th>`).join('');
    let trs = '';
    for (let i = startIdx; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      trs += `<tr>${cols.map(c => `<td>${c}</td>`).join('')}</tr>`;
    }
    return `<div class="chat-table-wrapper"><table class="chat-summary-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
  });

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
    if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<li') || p.startsWith('<div') || p.startsWith('<table')) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

function appendChatMessage(role, text, followups = [], clarification = null) {
  const stream = $('chatStream');
  const msg = document.createElement('div');
  msg.className = `chat-message ${role}-message`;
  let bodyContent = role === 'assistant' ? formatMarkdown(text) : `<p>${esc(text)}</p>`;
  if (role === 'assistant' && clarification) {
    bodyContent += renderClarificationCard(clarification);
  }
  if (role === 'assistant' && Array.isArray(followups) && followups.length > 0) {
    bodyContent += `<div class="chat-followups-container">` +
      followups.map(f => `<button class="chip-followup" onclick="useQuickPrompt('${esc(f)}')">${esc(f)} &rarr;</button>`).join('') +
      `</div>`;
  }
  msg.innerHTML = `<div class="msg-avatar">${role === 'user' ? 'U' : 'O'}</div><div class="msg-body">${bodyContent}</div>`;
  stream.appendChild(msg);
  stream.scrollTop = stream.scrollHeight;
  stream.scrollLeft = 0;
}

function extractCleanUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  if (s === '—' || s.toLowerCase() === 'unavailable') return '';

  const m = s.match(/\[.*?\]\((https?:\/\/[^\s\)]+)\)/i) || s.match(/\[.*?\]\(([^\s\)]+)\)/i);
  if (m) {
    const inner = m[1].trim();
    return inner.startsWith('http://') || inner.startsWith('https://') ? inner : `https://${inner}`;
  }

  const m2 = s.match(/https?:\/\/[^\s)\]]+/i);
  if (m2) return m2[0];

  if (!/\s/.test(s) && /^(?:www\.|[a-zA-Z0-9-]+\.(?:com|org|net|io|ai|co|app|dev|tech|xyz|so|me|ly|cc))(?:\/[^\s]*)?$/i.test(s)) {
    return `https://${s}`;
  }

  return '';
}

function renderProspectSheet(data) {
  $('sheetTitle').textContent = data.title || 'Prospect Sheet';
  const qualifiedCount = (data.rows || []).filter(r => r.overall_qualification_status === 'QUALIFIED').length;
  const reviewCount = (data.rows || []).filter(r => r.overall_qualification_status === 'NEEDS_REVIEW').length;
  if (qualifiedCount > 0 && reviewCount > 0) {
    $('rowCountBadge').textContent = `${qualifiedCount} Qualified / ${reviewCount} In Review`;
  } else if (qualifiedCount > 0) {
    $('rowCountBadge').textContent = `${qualifiedCount} Qualified`;
  } else if (reviewCount > 0) {
    $('rowCountBadge').textContent = `${reviewCount} In Review`;
  } else {
    $('rowCountBadge').textContent = `${(data.rows || []).length} Rows`;
  }
  const totalRows = (data.rows || []).length;
  const footerRowEl = $('sheetFooterRowCount');
  if (footerRowEl) footerRowEl.textContent = `Rows: ${totalRows}`;

  const thCols = data.columns.map(c => {
    return `<th data-key="${esc(c.key)}" class="th-col-${esc(c.key)}">${esc(c.label)}</th>`;
  }).join('');
  $('tableHead').innerHTML = `<tr><th class="th-checkbox"><input type="checkbox" id="selectAllRows" onchange="toggleSelectAllRows(this)"></th><th class="th-index">#</th>${thCols}<th class="th-actions">Actions</th></tr>`;

  if (!data.rows || data.rows.length === 0) {
    $('tableBody').innerHTML = '<tr><td colspan="14" style="text-align:center;padding:56px 16px;color:#64748b;font-size:0.9rem;">No qualified companies met all strict criteria. Try refining or expanding your search prompt.</td></tr>';
    $('summaryViewText').innerHTML = formatMarkdown(data.summary || '');
    $('followupChipsList').innerHTML = (data.suggested_followups || []).map(f => `<button class="chip-followup" onclick="useQuickPrompt('${esc(f)}')">${esc(f)}</button>`).join('');
    return;
  }

  const rowsHtml = data.rows.map((row, idx) => {
    const cells = data.columns.map(col => {
      const val = row[col.key] || '—';
      const baseAttrs = `data-col="${esc(col.label)}" data-key="${esc(col.key)}" data-row="${idx + 1}" data-val="${esc(String(val))}"`;
      const cellAttrs = `${baseAttrs} onclick="handleCellClick(this)"`;

      if (col.key === 'fit_score') {
        const score = parseInt(val) || 90;
        return `<td ${cellAttrs}><span class="fit-badge ${score >= 90 ? 'high' : 'medium'}">${score} &gt;</span></td>`;
      }
      if (col.key === 'company_name' || col.key === 'company') {
        return `<td ${cellAttrs}><div class="company-cell"><div class="company-cell-icon" aria-hidden="true">${esc(String(val)[0]?.toUpperCase() || 'C')}</div><span class="cell-truncate-text" style="font-weight:600;">${esc(val)}</span></div></td>`;
      }
      if (col.key === 'full_name' || col.key === 'name' || col.key === 'decision_maker' || col.key === 'founder_name') {
        return `<td ${cellAttrs}><div class="company-cell"><div class="company-cell-icon" aria-hidden="true" style="background:#e0e7ff;color:#4338ca;">${esc(String(val)[0]?.toUpperCase() || 'P')}</div><span class="cell-truncate-text" style="font-weight:600;">${esc(val)}</span></div></td>`;
      }
      if (typeof val === 'string' && (val.toLowerCase() === 'unavailable' || val === '—' || !val.trim()) && !col.key.includes('linkedin') && col.type !== 'link') {
        return `<td ${cellAttrs}><span style="color:#94a3b8;font-style:italic;">Unavailable</span></td>`;
      }
      if (col.key === 'email' || col.key === 'work_email' || col.key === 'outreach_email') {
        const cleanEm = (typeof val === 'string' ? val.match(/[\w\.-]+@[\w\.-]+\.\w+/) : null)?.[0] || val;
        return `<td ${cellAttrs}><div class="contact-cell"><span class="contact-code-icon">{ }</span><a href="mailto:${esc(cleanEm)}" class="cell-link cell-link-truncate" onclick="event.stopPropagation()">${esc(cleanEm)}</a></div></td>`;
      }
      const isLinkedInCol = col.key.includes('linkedin') || (typeof val === 'string' && val.includes('linkedin.com'));
      if (isLinkedInCol) {
        const cleanLink = extractCleanUrl(val);
        const pName = row.founder_name || row.decision_maker || row.full_name || '';
        const cName = row.company_name || row.company || '';
        let targetUrl = '';
        let displayLabel = '';

        if (cleanLink && cleanLink.includes('linkedin.com')) {
          targetUrl = cleanLink;
          displayLabel = cleanLink.replace(/^https?:\/\/(www\.)?linkedin\.com\//, 'linkedin.com/');
        } else if (pName || cName) {
          const query = (pName + ' ' + cName).trim();
          targetUrl = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(query)}`;
          displayLabel = `Search on LinkedIn ↗`;
        } else {
          targetUrl = 'https://www.linkedin.com';
          displayLabel = 'LinkedIn ↗';
        }

        return `<td ${baseAttrs} class="td-link-cell" onclick="openExternalUrl(event, '${esc(targetUrl)}')" style="cursor:pointer;" title="Open on LinkedIn"><div class="linkedin-cell"><span class="linkedin-pill-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24z"/></svg></span><a href="${esc(targetUrl)}" target="_blank" rel="noopener noreferrer" class="cell-link cell-link-truncate" onclick="event.stopPropagation()">${esc(displayLabel)}</a></div></td>`;
      }
      if (col.key === 'domain' || col.key === 'website') {
        const cleanWeb = extractCleanUrl(val);
        const displayWeb = cleanWeb.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || val;
        const targetUrl = cleanWeb || (String(val).startsWith('http') ? String(val) : `https://${val}`);
        return `<td ${baseAttrs} class="td-link-cell" onclick="openExternalUrl(event, '${esc(targetUrl)}')" style="cursor:pointer;" title="Open website"><a href="${esc(targetUrl)}" target="_blank" rel="noopener noreferrer" class="cell-link cell-link-truncate" onclick="event.stopPropagation()">${esc(displayWeb)}</a></td>`;
      }
      if (col.type === 'badge' || col.key.endsWith('_status') || col.key === 'crm_platform' || col.key === 'verification_status' || col.key === 'quality_status') {
        const vLower = String(val).toLowerCase();
        let cls = '';
        if (vLower.includes('qualified') && !vLower.includes('disqualified') && !vLower.includes('needs review')) cls = 'verified';
        else if (vLower.includes('review') || vLower.includes('needs review') || vLower.includes('unverified') || vLower.includes('stale') || vLower.includes('integration') || vLower.includes('architecture') || vLower.includes('incomplete') || vLower.includes('missing')) cls = 'needs-review';
        else if (vLower.includes('disqualified') || vLower.includes('insufficient')) cls = 'insufficient';
        else if (vLower.includes('unavailable')) cls = 'unavailable';
        else if (vLower.includes('hubspot') && !vLower.includes('salesforce')) cls = 'hubspot';
        else if (vLower.includes('salesforce') && !vLower.includes('hubspot')) cls = 'salesforce';
        else if (vLower.includes('hubspot') && vLower.includes('salesforce')) cls = 'salesforce';
        return `<td ${cellAttrs}><span class="cell-pill ${cls}">${esc(val)}</span></td>`;
      }

      if (col.type === 'link' || col.key.endsWith('_url') || col.key.endsWith('_link')) {
        let cleanGeneric = typeof val === 'string' ? extractCleanUrl(val) : '';
        const targetUrl = cleanGeneric || (typeof val === 'string' && val.startsWith('http') ? val : (val && val !== '—' && val.toLowerCase() !== 'unavailable' ? `https://${val}` : ''));
        if (targetUrl) {
          let label = targetUrl;
          const mdMatch = typeof val === 'string' ? val.match(/\[([^\]]+)\]/) : null;
          if (mdMatch) {
            label = mdMatch[1];
          } else {
            try {
              const host = new URL(targetUrl).hostname.toLowerCase();
              label = host.replace('www.', '') + ' ↗';
            } catch {}
          }
          return `<td ${baseAttrs} class="td-link-cell" onclick="openExternalUrl(event, '${esc(targetUrl)}')" style="cursor:pointer;" title="Open link"><a href="${esc(targetUrl)}" target="_blank" rel="noopener noreferrer" class="cell-link cell-link-truncate" onclick="event.stopPropagation()">${esc(label)}</a></td>`;
        }
      }

      return `<td ${cellAttrs}><span class="cell-truncate-text">${esc(val)}</span></td>`;
    }).join('');

    const drillBtn = `<button class="btn-table-drill" onclick="runDeepResearchFromProspectByIndex(${idx})">Deep Research &rarr;</button>`;

    const actions = `<td class="action-cell" onclick="event.stopPropagation()"><div class="action-btn-group">
      ${drillBtn}
      <button class="btn-table-hook" onclick="showEmailModal(${idx})">Outreach Email &rarr;</button>
    </div></td>`;

    return `<tr><td class="cell-checkbox" onclick="event.stopPropagation()"><input type="checkbox" class="row-checkbox" onchange="updateSelectedCount()"></td><td class="row-num-cell" data-row="${idx + 1}">${idx + 1}</td>${cells}${actions}</tr>`;
  }).join('');

  const addRowHtml = `<tr class="table-add-row"><td colspan="${data.columns.length + 3}" style="padding-left:14px;color:#94a3b8;font-size:0.85rem;cursor:pointer;background:#fafbfc;" onclick="focusPromptInput()">+</td></tr>`;
  $('tableBody').innerHTML = rowsHtml + addRowHtml;

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

function runDeepResearchFromProspectByIndex(idx) {
  const row = currentProspectSheet?.rows?.[idx];
  if (!row) return;
  const comp = row.company_name || row.company || row.organization || '';
  const dom = row.domain || row.website || '';
  navigateTo('deep', { company: comp, domain: dom, auto: true });
}

function runDeepResearchFromProspect(comp, dom) {
  navigateTo('deep', { company: comp, domain: dom, auto: true });
}

function showEmailModal(idx) {
  if (!currentProspectSheet?.rows?.[idx]) return;
  const row = currentProspectSheet.rows[idx];
  const comp = row.company_name || row.company || row.organization || 'Company';

  let cleanDomain = '';
  const rawDom = row.domain || row.website || '';
  try {
    const parsed = new URL(rawDom.startsWith('http') ? rawDom : `https://${rawDom}`);
    cleanDomain = parsed.hostname.replace(/^www\./, '');
  } catch {
    cleanDomain = rawDom.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || `${comp.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
  }

  const rawPerson = row.founder_name || row.decision_maker || row.outreach_decision_maker || row.full_name || row.name || '';
  const isGenericPerson = !rawPerson || /decision\s*maker|unavailable|unknown|n\/a|someone/i.test(rawPerson);

  let personDisplay = '';
  let greeting = '';
  let email = '';

  if (!isGenericPerson) {
    const cleanPerson = rawPerson.split(',')[0].split(' - ')[0].trim();
    const firstName = cleanPerson.split(' ')[0] || cleanPerson;
    personDisplay = cleanPerson;
    greeting = `Hi ${firstName},`;
    email = row.outreach_email || `${firstName.toLowerCase()}@${cleanDomain}`;
  } else {
    personDisplay = `${comp} Leadership Team`;
    greeting = `Hi ${comp} Team,`;
    email = row.outreach_email || `team@${cleanDomain}`;
  }

  const promptContext = currentProspectSheet?.query || currentProspectSheet?.title || '';
  let subject = row.outreach_subject || '';
  if (!subject) {
    if (promptContext.toLowerCase().includes('cybersecurity') || (row.description || '').toLowerCase().includes('security')) {
      subject = `Scaling ${comp}'s cloud security & compliance operations`;
    } else if (promptContext.toLowerCase().includes('crm') || promptContext.toLowerCase().includes('hubspot') || promptContext.toLowerCase().includes('salesforce')) {
      subject = `Optimizing ${comp}'s CRM revenue architecture`;
    } else if (promptContext.toLowerCase().includes('fund') || (row.match_reason || '').toLowerCase().includes('series') || (row.match_reason || '').toLowerCase().includes('fund')) {
      subject = `${comp}'s recent growth & operational scaling`;
    } else {
      subject = `Strategic question regarding ${comp}'s pipeline`;
    }
  }

  let body = row.outreach_body || '';
  const isBodyGeneric = !body || /I noticed.*recent initiatives and wanted to reach out/i.test(body) || body.includes('Hi Decision Maker');

  if (isBodyGeneric) {
    const desc = row.description || '';
    const matchReason = row.match_reason || '';
    let triggerSentence = '';
    if (matchReason && !matchReason.toLowerCase().includes('discovered via neural search')) {
      triggerSentence = `Congratulations on ${comp}'s recent milestone: ${matchReason}.`;
    } else if (desc) {
      triggerSentence = `I've been following ${comp}'s trajectory—specifically how you're advancing ${desc.replace(/\.$/, '')}.`;
    } else {
      triggerSentence = `I've been closely following ${comp}'s trajectory and focus in the ${promptContext || 'SaaS'} space.`;
    }

    let operationalPain = '';
    if (promptContext.toLowerCase().includes('cybersecurity') || desc.toLowerCase().includes('security')) {
      operationalPain = `As cybersecurity SaaS platforms scale beyond recent funding rounds, aligning threat intelligence telemetry with go-to-market pipeline handoffs often introduces substantial operational friction.`;
    } else if (promptContext.toLowerCase().includes('hubspot') || promptContext.toLowerCase().includes('salesforce') || row.crm_platform) {
      operationalPain = `Managing high-velocity GTM pipelines across CRM systems often leads to routing attribution lag and manual data reconciliation for RevOps teams.`;
    } else {
      operationalPain = `As you expand your headcount and customer footprint, automating pipeline validation and data workflows without adding administrative headcount becomes critical.`;
    }

    body = `${greeting}\n\n${triggerSentence}\n\n${operationalPain}\n\nWe provide purpose-built workflow automation that helps high-growth leadership teams streamline these processes with zero engineering overhead.\n\nWould you or someone on your team be open to a brief 10-minute introductory conversation next week to see how other teams in your space approach this?`;
  } else if (body.includes('Hi Decision Maker,')) {
    body = body.replace('Hi Decision Maker,', greeting);
  }

  $('modalHookTitle').textContent = `Tailored Cold Outreach · ${comp}`;
  $('modalTargetRecipient').textContent = `${personDisplay} (${comp})`;
  $('modalTargetEmail').textContent = email;
  $('modalEmailSubject').value = subject;
  $('modalEmailBody').value = body;

  const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  $('modalMailtoBtn').href = mailtoUrl;

  $('hookModal').style.display = 'flex';
}

function closeHookModal(e) {
  if (e && e.target !== e.currentTarget && !e.target.classList.contains('modal-close')) return;
  $('hookModal').style.display = 'none';
}

let currentSelectedCell = null;

function toggleSelectAllRows(masterCheckbox) {
  const isChecked = masterCheckbox.checked;
  document.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = isChecked; });
  updateSelectedCount();
}

function updateSelectedCount() {
  const selected = document.querySelectorAll('.row-checkbox:checked').length;
  const statusEl = $('statusCellIndicator');
  if (statusEl) {
    statusEl.textContent = selected > 0 ? `${selected} row${selected > 1 ? 's' : ''} selected` : (currentSelectedCell ? `1 cell selected (${currentSelectedCell.coord})` : '0 cells selected');
  }
}

function focusPromptInput() {
  const inp = $('promptInput');
  if (inp) {
    inp.focus();
    inp.placeholder = 'Add new company or column to sheet...';
  }
}

function handleCellClick(td) {
  if (!td || td.classList.contains('action-cell') || td.classList.contains('cell-checkbox')) return;
  document.querySelectorAll('.gtm-table td.cell-selected').forEach(c => c.classList.remove('cell-selected'));
  td.classList.add('cell-selected');

  const val = td.getAttribute('data-val') || td.textContent.trim();
  const colName = td.getAttribute('data-col') || 'Cell';
  const rowNum = td.getAttribute('data-row') || '1';
  const colIdx = td.cellIndex;
  const colLetter = String.fromCharCode(65 + Math.min(colIdx, 25));
  const coord = `${colLetter}${rowNum}`;

  currentSelectedCell = { val, colName, coord };

  const coordEl = $('formulaCellCoord');
  if (coordEl) coordEl.textContent = coord;
  const valBox = $('formulaValueBox');
  if (valBox) valBox.textContent = val || '(Empty)';
  const btnExp = $('btnFormulaExpand');
  if (btnExp) btnExp.style.display = val.length > 25 ? 'inline-block' : 'none';

  const statusEl = $('statusCellIndicator');
  if (statusEl) statusEl.textContent = `1 cell selected (${coord})`;

  const colKey = td.getAttribute('data-key') || '';
  if (colKey.includes('linkedin') || colKey.includes('website') || colKey.includes('domain') || colKey.includes('url')) {
    return;
  }
  if (val && val !== '—' && (val.length > 35 || ['description', 'match_reason', 'crm_evidence_detail', 'business_signal', 'outreach_hook'].includes(colKey))) {
    openCellDetailModal(colName, val);
  }
}

function openExternalUrl(e, url) {
  if (!url || url === '#' || url === '—') return;
  if (e && e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'a') {
    return;
  }
  const clean = extractCleanUrl(url) || (url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`);
  const win = window.open(clean, '_blank', 'noopener,noreferrer');
  if (win) {
    win.focus();
  } else {
    const a = document.createElement('a');
    a.href = clean;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

function openCellDetailFromFormula() {
  if (!currentSelectedCell || !currentSelectedCell.val) return;
  openCellDetailModal(currentSelectedCell.colName, currentSelectedCell.val);
}

function openCellDetailModal(colName, fullText) {
  const modal = $('cellDetailModal');
  if (!modal) return;
  const colEl = $('cellDetailColName');
  if (colEl) colEl.textContent = colName || 'Cell Value';
  const textEl = $('cellDetailFullText');
  if (textEl) textEl.textContent = fullText || '';
  const countEl = $('cellDetailCharCount');
  if (countEl) countEl.textContent = `${(fullText || '').length} characters`;
  const lbl = $('btnCopyCellLabel');
  if (lbl) lbl.textContent = 'Copy Content';
  modal.style.display = 'flex';
}

function closeCellDetailModal(e) {
  if (e && e.target !== e.currentTarget && !e.target.classList.contains('modal-close')) return;
  const modal = $('cellDetailModal');
  if (modal) modal.style.display = 'none';
}

function copyCellDetailText() {
  const text = $('cellDetailFullText')?.textContent || '';
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const lbl = $('btnCopyCellLabel');
    if (lbl) {
      lbl.textContent = '✓ Copied';
      setTimeout(() => { lbl.textContent = 'Copy Content'; }, 1800);
    }
  }).catch(() => {});
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeCellDetailModal();
    closeHookModal();
  }
});

function copyFullEmail() {
  const recipient = $('modalTargetRecipient').textContent;
  const email = $('modalTargetEmail').textContent;
  const subject = $('modalEmailSubject').value;
  const body = $('modalEmailBody').value;
  const fullText = `To: ${recipient} <${email}>\nSubject: ${subject}\n\n${body}`;

  navigator.clipboard.writeText(fullText).then(() => {
    const btn = $('btnCopyEmail');
    const orig = btn.textContent;
    btn.textContent = 'Copied to Clipboard!';
    setTimeout(() => { btn.textContent = orig; }, 1800);
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
  const fullText = `${headers}\n${rows}`;
  const btn = $('btnCopyForSheets') || document.querySelector('.btn-action-outline');
  const showFeedback = () => {
    if (btn) {
      const orig = btn.innerHTML;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1800);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullText).then(showFeedback).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = fullText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showFeedback();
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = fullText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showFeedback();
  }
}

function setCompany(name, domain) {
  $('companyInput').value = name;
  $('domainInput').value = domain;
  $('heroSection').style.display = 'none';
  executeResearch();
}

function newSearch() {
  $('resultsSection').style.display = 'none';
  $('loadingState').style.display = 'none';
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
  const bar = $('progressBar');
  if (bar) {
    bar.style.animation = 'none';
    bar.offsetHeight;
    bar.style.animation = 'progress-grow 18s ease-out forwards';
  }
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
  $('loadingState').style.display = 'block';
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
    $('loadingState').style.display = 'none';
    if (json.success && json.data) {
      renderReport(json);
      $('heroSection').style.display = 'none';
      $('resultsSection').style.display = 'block';
    } else {
      alert((json.errors || []).join('\n') || 'No data found');
    }
  } catch (err) {
    stopLoadingAnimation();
    $('loadingState').style.display = 'none';
    alert(`Research error: ${err.message}`);
  } finally {
    btn.disabled = false;
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
      ? ` <a href="${esc(d.employee_size_source)}" target="_blank" rel="noopener" style="font-size:0.72rem;color:var(--accent-blue);font-family:var(--font-mono);margin-left:4px;white-space:nowrap;">Source ↗</a>` 
      : '';
    empEl.innerHTML = `${esc(d.employee_size)}${srcLink}`;
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
      <div class="signal-text">${esc(s.signal)}</div>
      ${s.source_url ? `<a class="signal-source" href="${esc(s.source_url)}" target="_blank" rel="noopener">View official source ↗</a>` : ''}
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
        <div class="person-name">${esc(m.name)}</div>
        <div class="person-role">${esc(m.role || 'Executive')}</div>
      </div>
      ${m.source_url ? `<a class="person-link" href="${esc(m.source_url)}" target="_blank" rel="noopener">Source ↗</a>` : ''}
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
      a.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;display:inline-block;vertical-align:middle;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>${esc(item)} ↗`;
      container.appendChild(a);
    } else if (item.includes('@') && !item.includes(' ')) {
      const a = document.createElement('a');
      a.className = 'contact-item';
      a.href = `mailto:${item}`;
      a.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;display:inline-block;vertical-align:middle;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>${esc(item)}`;
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
      <span class="confidence-field">${esc(label)}</span>
      <span class="confidence-badge ${badgeClass}">${esc(level)}</span>
    `;
    container.appendChild(div);
  }
}

function formatSourceLink(src) {
  if (!src) return '';
  const str = String(src).trim();
  if (str.startsWith('http://') || str.startsWith('https://')) {
    const domain = extractDomain(str);
    return `<a class="firmo-source-link" href="${esc(str)}" target="_blank" rel="noopener">${esc(domain)} ↗</a>`;
  }
  const urlMatch = str.match(/https?:\/\/[^\s\)]+/);
  if (urlMatch) {
    const cleanLabel = str.replace(urlMatch[0], '').replace(/[()·•\-]/g, '').trim() || extractDomain(urlMatch[0]);
    return `<a class="firmo-source-link" href="${esc(urlMatch[0])}" target="_blank" rel="noopener">${esc(cleanLabel)} ↗</a>`;
  }
  return `<span>${esc(str)}</span>`;
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
    hqSub.innerHTML = `Source: ${formatSourceLink(src)} <span class="firmo-badge ${conf}">${esc(conf)}</span>`;
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
    typeSub.innerHTML = `Source: ${formatSourceLink(src)} <span class="firmo-badge ${conf}">${esc(conf)}</span>`;
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
    modelSub.innerHTML = `Source: ${formatSourceLink(src)} <span class="firmo-badge ${conf}">${esc(conf)}</span>`;
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
    techSub.innerHTML = `Source: ${formatSourceLink(src)} <span class="firmo-badge ${conf}">${esc(conf)}</span>`;
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
            ${esc(domain)}
          </span>
          <a class="source-ext-link" href="${esc(src.url)}" target="_blank" rel="noopener">
            <span>Source</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        </div>
        <a class="source-title" href="${esc(src.url)}" target="_blank" rel="noopener">${esc(displayTitle)}</a>
        <div class="source-snippet">${esc(snippet)}</div>
      </div>
      <div class="source-card-bottom">
        <span>${dateStr ? `Published: ${dateStr}` : 'Research Evidence'}</span>
        <span style="color: var(--text-muted); font-weight: 500;">↗ View Source</span>
      </div>
    `;
    container.appendChild(div);
  });
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

function exportJSON() {
  if (!currentData) return;
  const blob = new Blob([JSON.stringify(currentData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(currentData.data?.company_name || 'company').toLowerCase().replace(/\s+/g, '_')}_dossier.json`;
  a.click();
}

function getSearchHistory() {
  try {
    const raw = localStorage.getItem('outmate_search_history');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSearchToHistory(sheet, prompt) {
  return;
}

function updateHistoryBadge() {
  return;
}

function openHistoryDrawer() {
  const drawer = $('historyDrawer');
  if (drawer) {
    drawer.style.display = 'flex';
    renderHistoryList();
  }
}

function closeHistoryDrawer(e) {
  if (e && e.target && e.target !== $('historyDrawer') && !e.target.classList.contains('modal-close')) {
    return;
  }
  const drawer = $('historyDrawer');
  if (drawer) drawer.style.display = 'none';
}

function renderHistoryList() {
  const container = $('historyListContainer');
  if (!container) return;
  const history = getSearchHistory();
  if (!history || history.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 16px;color:#64748b;font-size:0.82rem;line-height:1.5;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:10px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <div style="font-weight:600;color:#334155;margin-bottom:4px;">No Saved Searches Yet</div>
        Every search and prospect sheet you generate is automatically saved here.
      </div>
    `;
    return;
  }

  const activeId = localStorage.getItem('outmate_last_active_search_id');

  container.innerHTML = history.map(item => {
    const isActive = item.id === activeId;
    const timeAgo = formatTimeAgo(item.timestamp);
    return `
      <div class="history-item-card ${isActive ? 'active-history-card' : ''}" onclick="restoreSearchFromHistory('${item.id}')" style="${isActive ? 'border-color:#3b82f6;background:#f0f9ff;' : ''}">
        <div class="history-item-top">
          <span class="history-item-title">${esc(item.title)}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="history-item-badge">${item.rowCount || 0} Rows</span>
            <button onclick="deleteHistoryItem('${item.id}', event)" title="Delete" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:1.1rem;line-height:1;padding:2px 4px;">&times;</button>
          </div>
        </div>
        <div class="history-item-prompt">${esc(item.prompt)}</div>
        <div class="history-item-time">${timeAgo}</div>
      </div>
    `;
  }).join('');
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function restoreSearchFromHistory(id, closeDrawer = true) {
  const history = getSearchHistory();
  const item = history.find(h => h.id === id);
  if (!item || !item.sheet) return;

  currentProspectSheet = item.sheet;
  localStorage.setItem('outmate_last_active_search_id', id);

  const chips = document.querySelector('.prompt-chips');
  if (chips) chips.style.display = 'none';

  const stream = $('chatStream');
  if (stream) {
    stream.innerHTML = '';
    appendChatMessage('user', item.prompt);
    appendChatMessage('assistant', item.sheet.summary || `Restored sheet with ${item.sheet.rows?.length || 0} prospects from history.`);
  }

  renderProspectSheet(currentProspectSheet);
  if (closeDrawer) closeHistoryDrawer();
  updateHistoryBadge();
}

function deleteHistoryItem(id, event) {
  if (event) event.stopPropagation();
  let history = getSearchHistory();
  history = history.filter(h => h.id !== id);
  try {
    localStorage.setItem('outmate_search_history', JSON.stringify(history));
    if (localStorage.getItem('outmate_last_active_search_id') === id) {
      if (history.length > 0) {
        localStorage.setItem('outmate_last_active_search_id', history[0].id);
      } else {
        localStorage.removeItem('outmate_last_active_search_id');
      }
    }
  } catch (e) {
    console.error(e);
  }
  updateHistoryBadge();
  renderHistoryList();
}

function clearAllSearchHistory() {
  localStorage.removeItem('outmate_search_history');
  localStorage.removeItem('outmate_last_active_search_id');
  updateHistoryBadge();
  renderHistoryList();
}
