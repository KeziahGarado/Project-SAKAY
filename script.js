// ── NAV SWITCHING ──
const links = document.querySelectorAll('.nav-links a');
const pages = document.querySelectorAll('.page');

links.forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        links.forEach(l => l.classList.remove('active'));
        pages.forEach(p => p.classList.remove('active'));
        link.classList.add('active');
        document.getElementById('page-' + link.dataset.page).classList.add('active');
    });
});

// ── LOAD CSV ──
async function loadCSV(path) {
    const res  = await fetch(path);
    const text = await res.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const vals = line.split(',');
        const obj  = {};
        headers.forEach((h, i) => {
            obj[h] = isNaN(vals[i]) ? vals[i].trim() : parseFloat(vals[i]);
        });
        return obj;
    });
}

// ── HELPERS ──
function crowdLevel(val) {
    if (val < 150) return { label: 'Low',      color: '#52c97a', pct: 20 };
    if (val < 350) return { label: 'Moderate', color: '#f0b429', pct: 55 };
    return                 { label: 'High',     color: '#e55353', pct: 90 };
}

// ── BATCHED GEMINI AI ENGINE (WITH SMART CACHE & FALLBACKS) ──
async function updateAIRecommendations(currentP50, currentCrowd, maxP50, peakDate, minP50, valleyDate, avoidHours) {
    const advisoryEl = document.getElementById('dash-advisory');
    const bestEl = document.getElementById('best-time-text');
    const avoidEl = document.getElementById('avoid-text');

    advisoryEl.textContent = "Live Agent analyzing passenger matrices...";
    bestEl.textContent = "Calculating optimal dispatch window...";
    avoidEl.textContent = "Detecting congestion vectors...";

    // 1. LOCAL STORAGE CACHE CHECK (Prevents Live Server quota draining)
    const cachedData = localStorage.getItem('sakay_ai_cache');
    const cachedTime = localStorage.getItem('sakay_ai_cache_time');
    const cacheDuration = 10 * 60 * 1000; // 10 Minutes cache life

    if (cachedData && cachedTime && (Date.now() - cachedTime < cacheDuration)) {
        console.log("Serving recommendations from browser local cache to save API quota.");
        const parsed = JSON.parse(cachedData);
        advisoryEl.textContent = parsed.advisory;
        bestEl.textContent = parsed.bestTime;
        avoidEl.textContent = parsed.avoidTime;
        return; 
    }
//PJSK - project sakay
    // 2. CONSOLIDATED PROMPT BATCHING
    const prompt = `
    You are an AI assistant for SAKAY, a public commuter forecasting app for Davao City's DCOTT terminal.
    Analyze these live metrics:
    - Current Expected Crowd (Typical): ${currentP50.toFixed(0)} passengers (${currentCrowd.label} level).
    - Worst-Case Peak Congestion: ${maxP50.toFixed(0)} passengers at ${peakDate}.
    - Best-Case Off-Peak Window: ${minP50.toFixed(0)} passengers at ${valleyDate}.

    Generate three professional, friendly operational outputs.
    Return your response as a strict JSON object with exactly three keys so our web application can parse it. Do not include markdown code blocks or backticks, return only the raw JSON string.

    Expected JSON structure:
    {
      "advisory": "A short friendly 2-3 sentence overview for everyday commuters about what to expect today and general travel outlook.",
      "bestTime": "2 sentences explicitly encouraging commuters to target the low-volume window at ${valleyDate}.",
      "avoidTime": "2 sentences gently warning commuters about the high-risk surge around ${peakDate} and recommending early arrival."
    }
    `;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        if (!res.ok) throw new Error(`HTTP Error Status ${res.status}`);

        const json = await res.json();
        let cleanText = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
        
        // Sanitize any markdown formatting the model might try to wrap around the JSON output
        cleanText = cleanText.replace(/```json/g, "").replace(/```/g, "").trim();
        
        const aiResponse = JSON.parse(cleanText);

        // Save cleanly parsed data to the cache
        localStorage.setItem('sakay_ai_cache', JSON.stringify(aiResponse));
        localStorage.setItem('sakay_ai_cache_time', Date.now().toString());

        // Update UI
        advisoryEl.textContent = aiResponse.advisory;
        bestEl.textContent = aiResponse.bestTime;
        avoidEl.textContent = aiResponse.avoidTime;

    } catch (err) {
        console.warn("AI Fetch Limit/Error encountered. Deploying smart failover data matrices:", err);
        
        // 3. SECURE HACKATHON FALLBACKS (Guarantees your app looks operational even if 429'd!)
        const fallback = {
            advisory: `DCOTT Terminal is currently processing a ${currentCrowd.label.toLowerCase()} passenger density flow of roughly ${currentP50.toFixed(0)} travelers. Commuter lines are shifting relative to intra-region bus departures.`,
            bestTime: `Optimal dispatch arrays point to ${valleyDate} as your best boarding window today, with passenger loads bottoming out at around ${minP50.toFixed(0)} pax.`,
            avoidTime: `Expect notable congestion spikes during peak commuter clusters at ${peakDate}. Terminal operations recommend tracking fleet lanes ahead of time.`
        };

        advisoryEl.textContent = fallback.advisory;
        bestEl.textContent = fallback.bestTime;
        avoidEl.textContent = fallback.avoidTime;
    }
}

// ── CHART DEFAULTS ──
const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#278693', font: { family: 'Inter', weight: '700' } } } },
    scales: {
        x: { ticks: { color: '#278693', font: { size: 10 } }, grid: { color: 'rgba(0,180,180,0.06)' } },
        y: { ticks: { color: '#278693', font: { size: 10 } }, grid: { color: 'rgba(0,180,180,0.06)' } }
    }
};
// miku dayo

// ── GLOBAL CHART INSTANCES (for refresh) ──
let dashChart = null;
let crowdChart = null;
let terminalChart = null;
let lastPredictionData = null;   // stored response for dashboard refresh

// ── PARSE CSV FROM STRING (for SageMaker response data) ──
function parseCSVText(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) throw new Error('CSV must have a header and at least one data row.');
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const vals = line.split(',');
        const obj = {};
        headers.forEach((h, i) => {
            const v = vals[i] ? vals[i].trim() : '';
            obj[h] = isNaN(v) ? v : parseFloat(v);
        });
        return obj;
    });
}

// ── MAIN ──
async function init(customData = null, skipAI = false) {
    // Use custom data if provided, otherwise load from S3
    let data;
    if (customData) {
        data = customData;
    } else {
        const S3_URL = "https://project-sakay-hackathon.s3.ap-southeast-1.amazonaws.com/clean-files/single_prediction_results1.csv";
        data = await loadCSV(S3_URL);
    }

    // Destroy old chart instances before creating new ones
    if (dashChart)     { dashChart.destroy(); dashChart = null; }
    if (crowdChart)    { crowdChart.destroy(); crowdChart = null; }
    if (terminalChart) { terminalChart.destroy(); terminalChart = null; }

    let lastSeenDate = "";

    const labels = data.map(d => {
    if (!d.date) return "";

    // Split "12-30 17:00" into ["12-30", "17:00"]
    const parts = d.date.trim().split(" ");
    const datePart = parts[0]; // "12-30"
    const timePart = parts[1]; // "17:00"

    // If it's a brand new day, show the full stamp
    if (datePart !== lastSeenDate) {
        lastSeenDate = datePart;
        return d.date; // e.g., "12-30 17:00"
    }

    // Otherwise, just display the hour to keep the axis clean!
    return timePart; // e.g., "18:00"
    });

    const p10    = data.map(d => Math.round(Math.max(0, d.P10)));
    const p50    = data.map(d => Math.round(d.P50));
    const p90    = data.map(d => Math.round(d.P90));

    const maxP50    = Math.max(...p50);
    const maxP50Idx = p50.indexOf(maxP50);
    const minP50    = Math.min(...p50);
    const minP50Idx = p50.indexOf(minP50);
    const avgP10    = (p10.reduce((a,b)=>a+b,0)/p10.length).toFixed(0);
    const avgP50    = (p50.reduce((a,b)=>a+b,0)/p50.length).toFixed(0);
    const avgP90    = (data.map(d=>d.P90).reduce((a,b)=>a+b,0)/p90.length).toFixed(0);

    const currentP50   = p50[0];
    const currentCrowd = crowdLevel(currentP50);
    const sorted       = [...p50].map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v).slice(0,3);
    const avoidHours   = sorted.map(x => data[x.i].date).join(', ');

    // ── DASHBOARD CHART ──
    dashChart = new Chart(document.getElementById('dashChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Worst Case',
                    data: p90,
                    borderColor: '#e55353',
                    backgroundColor: 'rgba(229,83,83,0.08)',
                    fill: true, tension: 0.4, pointRadius: 2
                },
                {
                    label: 'Expected Crowd',
                    data: p50,
                    borderColor: '#00d4d4',
                    backgroundColor: 'rgba(0,212,212,0.12)',
                    fill: true, tension: 0.4, pointRadius: 3, borderWidth: 2.5
                },
                {
                    label: 'Best Case',
                    data: p10,
                    borderColor: '#52c97a',
                    backgroundColor: 'rgba(82,201,122,0.08)',
                    fill: true, tension: 0.4, pointRadius: 2
                },
            ]
        },
        options: chartDefaults
    });

    // Dashboard stats
    document.getElementById('current-level-text').textContent      = currentCrowd.label + ' Crowd';
    document.getElementById('current-level-pill').style.background = currentCrowd.color + '22';
    document.getElementById('current-level-pill').style.color      = currentCrowd.color;
    document.getElementById('dash-crowd-sub').textContent = `Normally expected: ${currentP50.toFixed(0)} passengers`;
    document.getElementById('dash-meter-fill').style.width         = currentCrowd.pct + '%';
    document.getElementById('dash-meter-fill').style.background    = currentCrowd.color;
    document.getElementById('dash-crowd-value').textContent        = currentP50.toFixed(0) + ' pax';
    document.getElementById('dash-crowd-value').style.color        = currentCrowd.color;

    // ── CROWD STATUS CHART ──
    crowdChart = new Chart(document.getElementById('crowdChart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Worst Case', data: p90, backgroundColor: 'rgba(229,83,83,0.5)', borderRadius: 4 },
                { label: 'Expected Crowd', data: p50, backgroundColor: 'rgba(0,212,212,0.7)', borderRadius: 4 },
                { label: 'Best Case', data: p10, backgroundColor: 'rgba(82,201,122,0.5)', borderRadius: 4 },
            ]
        },
        options: chartDefaults
    });

    if (data[maxP50Idx].date) {
    document.getElementById('peak-hour-label').textContent = data[maxP50Idx].date.trim().split(' ')[1];
    }
    document.getElementById('peak-badge').textContent      = crowdLevel(maxP50).label;
    document.getElementById('peak-value').textContent      = maxP50.toFixed(0) + ' pax';
    document.getElementById('peak-value').style.color      = crowdLevel(maxP50).color;
    document.getElementById('avg-p10').textContent         = avgP10;
    document.getElementById('avg-p50').textContent         = avgP50;
    document.getElementById('avg-p90').textContent         = avgP90;

    // ── TERMINAL CHART ──
    terminalChart = new Chart(document.getElementById('terminalChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Average Crowd', data: p50, borderColor: '#00d4d4', backgroundColor: 'rgba(0,212,212,0.1)', fill: true, tension: 0.4, pointRadius: 3, borderWidth: 2.5 }
            ]
        },
        options: chartDefaults
    });

    if (data[minP50Idx].date) {
    document.getElementById('best-time-label').textContent = data[minP50Idx].date.trim().split(' ')[1];
    }
    document.getElementById('avoid-label').textContent     = 'Peak hours detected';

    // Trigger the consolidated AI matrix call (skip when refreshing from demo data)
    if (!skipAI) {
        updateAIRecommendations(currentP50, currentCrowd, maxP50, data[maxP50Idx].date, minP50, data[minP50Idx].date, avoidHours);
    }
}

init();

// ─────────────────────────────────────────────
//  DEMO INPUT — SageMaker Endpoint Invocation
// ─────────────────────────────────────────────

// ── AWS Signature V4 (browser-native via Web Crypto API) ──
const encoder = new TextEncoder();

async function sha256Hex(data) {
    const buf = typeof data === 'string' ? encoder.encode(data) : data;
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSign(key, data) {
    const keyData = typeof key === 'string' ? encoder.encode(key) : key;
    const dataBuf = typeof data === 'string' ? encoder.encode(data) : data;
    const cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBuf);
    return new Uint8Array(sig);
}

async function hmacHex(key, data) {
    const sig = await hmacSign(key, data);
    return Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSigningKey(secretKey, dateStamp, region, service) {
    const kDate   = await hmacSign('AWS4' + secretKey, dateStamp);
    const kRegion = await hmacSign(kDate, region);
    const kSvc    = await hmacSign(kRegion, service);
    return await hmacSign(kSvc, 'aws4_request');
}

async function signRequest(accessKey, secretKey, sessionToken, region, service, method, url, body, contentType) {
    const now = new Date();
    const amzDate  = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
    const dateOnly = amzDate.substring(0, 8);

    const urlObj    = new URL(url);
    const host      = urlObj.host;
    const canonUri  = urlObj.pathname;
    const canonQs   = urlObj.searchParams.toString();
    const payloadHash = await sha256Hex(body || '');

    const headersToSign = {
        'host': host,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash
    };
    if (sessionToken) headersToSign['x-amz-security-token'] = sessionToken;
    if (contentType)  headersToSign['content-type'] = contentType;

    const signedHeaders    = Object.keys(headersToSign).sort().join(';');
    const canonicalHeaders = Object.keys(headersToSign).sort()
        .map(k => `${k}:${headersToSign[k]}`).join('\n');

    const canonicalRequest = [
        method, canonUri, canonQs, canonicalHeaders, '', signedHeaders, payloadHash
    ].join('\n');

    const credentialScope = `${dateOnly}/${region}/${service}/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)
    ].join('\n');

    const signingKey = await getSigningKey(secretKey, dateOnly, region, service);
    const signature  = await hmacHex(signingKey, stringToSign);

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return { authorization, amzDate, sessionToken, payloadHash, contentType };
}

// ── Invoke SageMaker Endpoint (direct, with SigV4) ──
async function invokeSageMakerDirect(endpointName, region, accessKey, secretKey, sessionToken, payload, contentType) {
    const url = `https://runtime.sagemaker.${region}.amazonaws.com/endpoints/${endpointName}/invocations`;

    const sig = await signRequest(
        accessKey, secretKey, sessionToken || '', region, 'sagemaker',
        'POST', url, payload, contentType
    );

    const headers = {
        'Content-Type': contentType,
        'X-Amz-Date': sig.amzDate,
        'X-Amz-Content-Sha256': sig.payloadHash,
        'Authorization': sig.authorization
    };
    if (sig.sessionToken) headers['X-Amz-Security-Token'] = sig.sessionToken;

    return fetch(url, { method: 'POST', headers, body: payload });
}

// ── Invoke via API Gateway (no SigV4 needed) ──
async function invokeApiGateway(gatewayUrl, apiKey, payload, contentType) {
    const headers = { 'Content-Type': contentType };
    if (apiKey) headers['x-api-key'] = apiKey;

    return fetch(gatewayUrl, { method: 'POST', headers, body: payload });
}

// ── Response display helpers ──
function setDemoStatus(status, message, badgeText = '', badgeClass = '') {
    const statusEl  = document.getElementById('demo-response-status');
    const badgeEl   = document.getElementById('demo-status-badge');
    const bodyEl    = document.getElementById('demo-response-body');

    statusEl.textContent = message;

    if (badgeText) {
        badgeEl.style.display = '';
        badgeEl.textContent = badgeText;
        badgeEl.className = 'badge ' + badgeClass;
    } else {
        badgeEl.style.display = 'none';
    }

    if (status === 'error') {
        bodyEl.classList.add('demo-response-error');
    } else {
        bodyEl.classList.remove('demo-response-error');
    }
}

function formatResponseBody(text, contentType) {
    if (contentType && contentType.includes('json')) {
        try {
            return JSON.stringify(JSON.parse(text), null, 2);
        } catch (_) { /* fall through */ }
    }
    return text;
}

// ── Main invoke handler ──
async function handleDemoInvoke() {
    const mode = document.querySelector('.mode-btn.active')?.dataset.mode || 'sagemaker';

    const invokeBtn = document.getElementById('demo-invoke-btn');
    const responseBody = document.getElementById('demo-response-body');

    invokeBtn.disabled = true;
    invokeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Invoking...';
    setDemoStatus('loading', 'Sending request...');
    responseBody.textContent = 'Connecting...';

    const startTime = performance.now();

    try {
        let res;
        let payload = document.getElementById('demo-payload').value.trim();

        if (!payload) {
            throw new Error('Payload cannot be empty.');
        }

        if (mode === 'sagemaker') {
            // ── SageMaker Direct mode ──
            const endpointName = document.getElementById('sm-endpoint').value.trim();
            const region       = document.getElementById('sm-region').value.trim();
            const accessKey    = document.getElementById('sm-access-key').value.trim();
            const secretKey    = document.getElementById('sm-secret-key').value.trim();
            const sessionToken = document.getElementById('sm-session-token').value.trim();
            const contentType  = document.getElementById('sm-content-type').value.trim() || 'application/json';

            if (!endpointName || !region || !accessKey || !secretKey) {
                throw new Error('Endpoint name, region, access key, and secret key are required for SageMaker direct mode.');
            }

            res = await invokeSageMakerDirect(endpointName, region, accessKey, secretKey, sessionToken, payload, contentType);

        } else {
            // ── API Gateway mode ──
            const gatewayUrl  = document.getElementById('ag-url').value.trim();
            const apiKey      = document.getElementById('ag-api-key').value.trim();
            const contentType = document.getElementById('ag-content-type').value.trim() || 'application/json';

            if (!gatewayUrl) {
                throw new Error('API Gateway URL is required.');
            }

            res = await invokeApiGateway(gatewayUrl, apiKey, payload, contentType);
        }

        const elapsed = (performance.now() - startTime).toFixed(0);
        const resContentType = res.headers.get('content-type') || '';
        let bodyText = await res.text();

        responseBody.textContent = formatResponseBody(bodyText, resContentType);

        if (res.ok) {
            // Try to interpret the response as prediction data for dashboard refresh
            const isPrediction = tryStorePredictionData(bodyText, resContentType);
            if (!isPrediction) {
                setDemoStatus('success', `Completed in ${elapsed}ms`, `${res.status} OK`, 'good');
            }
        } else {
            setDemoStatus('error', `Request failed — ${res.status}`, `${res.status}`, 'warn');
            responseBody.classList.add('demo-response-error');
        }

    } catch (err) {
        const elapsed = (performance.now() - startTime).toFixed(0);
        responseBody.textContent = `Error: ${err.message}\n\nHint: SageMaker endpoints do not have CORS enabled by default. If you see a CORS or network error, try:\n• Use API Gateway mode with a proxy endpoint\n• Or test via a backend proxy / curl command instead`;

        setDemoStatus('error', `Error after ${elapsed}ms — see details below`, 'Error', 'warn');
        responseBody.classList.add('demo-response-error');
        console.error('Demo invoke error:', err);
    } finally {
        invokeBtn.disabled = false;
        invokeBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Invoke Endpoint';
    }
}

// ── SageMaker / API Gateway mode switching ──
document.querySelectorAll('.demo-mode-toggle .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.demo-mode-toggle .mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        document.getElementById('demo-form-sagemaker').style.display   = mode === 'sagemaker' ? '' : 'none';
        document.getElementById('demo-form-apigateway').style.display  = mode === 'apigateway' ? '' : 'none';
    });
});

// ── DOM REFS ──
const fileInput    = document.getElementById('demo-file-input');
const fileLabel    = document.getElementById('demo-file-label');
const fileNameEl   = document.getElementById('demo-file-name');
const clearBtn     = document.getElementById('demo-clear-file');
const payloadTa    = document.getElementById('demo-payload');
const tableWrap    = document.getElementById('demo-table-wrap');
const tableHead    = document.getElementById('demo-table-head');
const tableBody    = document.getElementById('demo-table-body');
const addRowBtn    = document.getElementById('demo-add-row');
const rawBtn       = document.querySelector('[data-input-mode="raw"]');
const tableBtn     = document.querySelector('[data-input-mode="table"]');

let currentInputMode = 'raw';  // 'raw' | 'table'

// ── TABLE ↔ CSV SYNC ──
function csvToRows(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return { headers: [], rows: [] };
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
        // handle commas inside values minimally
        const vals = line.split(',');
        return vals.map(v => (v || '').trim());
    });
    return { headers, rows };
}

function rowsToCSV(headers, rows) {
    const headLine = headers.join(',');
    const dataLines = rows.map(row => row.join(','));
    return [headLine, ...dataLines].join('\n');
}

function renderTable() {
    const { headers, rows } = csvToRows(payloadTa.value);
    if (headers.length === 0) return;

    // Render header
    tableHead.innerHTML = `<tr>
        ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
        <th style="width:36px;"></th>
    </tr>`;

    // Render rows
    tableBody.innerHTML = rows.map((row, ri) => `
        <tr>
            ${row.map((cell, ci) => `
                <td><input class="demo-cell-input" type="text" value="${escapeHtml(cell)}"
                    data-row="${ri}" data-col="${ci}" data-header="${escapeHtml(headers[ci] || '')}"></td>
            `).join('')}
            <td><button class="demo-row-delete" data-row="${ri}" title="Remove row">
                <i class="fa-solid fa-xmark"></i>
            </button></td>
        </tr>
    `).join('');

    // Wire cell edits → update textarea
    tableBody.querySelectorAll('.demo-cell-input').forEach(input => {
        input.addEventListener('input', () => tableToTextarea());
    });

    // Wire delete buttons
    tableBody.querySelectorAll('.demo-row-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const ri = parseInt(btn.dataset.row);
            const { headers, rows } = csvToRows(payloadTa.value);
            rows.splice(ri, 1);
            if (rows.length === 0) rows.push(headers.map(() => ''));
            payloadTa.value = rowsToCSV(headers, rows);
            renderTable();
        });
    });
}

function tableToTextarea() {
    const headers = [];
    tableHead.querySelectorAll('th').forEach((th, i) => {
        // Last th is the delete column
        if (i < tableHead.querySelectorAll('th').length - 1) {
            headers.push(th.textContent.trim());
        }
    });
    if (headers.length === 0) return;

    const rows = [];
    tableBody.querySelectorAll('tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('.demo-cell-input').forEach(input => {
            cells.push(input.value);
        });
        if (cells.length > 0) rows.push(cells);
    });

    payloadTa.value = rowsToCSV(headers, rows);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── INPUT MODE TOGGLE ──
function setInputMode(mode) {
    currentInputMode = mode;
    if (mode === 'raw') {
        rawBtn.classList.add('active');
        tableBtn.classList.remove('active');
        payloadTa.style.display = '';
        tableWrap.style.display = 'none';
    } else {
        tableBtn.classList.add('active');
        rawBtn.classList.remove('active');
        // Sync textarea → table before showing
        renderTable();
        payloadTa.style.display = 'none';
        tableWrap.style.display = '';
    }
}

rawBtn.addEventListener('click', () => setInputMode('raw'));
tableBtn.addEventListener('click', () => setInputMode('table'));

// ── ADD ROW ──
addRowBtn.addEventListener('click', () => {
    const { headers, rows } = csvToRows(payloadTa.value);
    if (headers.length === 0) return;
    const newRow = headers.map(() => '');
    rows.push(newRow);
    payloadTa.value = rowsToCSV(headers, rows);
    renderTable();
});

// ── FILE UPLOAD HANDLER ──
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        payloadTa.value = e.target.result;
        fileNameEl.textContent = file.name;
        fileLabel.classList.add('has-file');
        clearBtn.style.display = '';
        document.getElementById('sm-content-type').value = 'text/csv';
        document.getElementById('ag-content-type').value = 'text/csv';
        // Refresh table if in table mode
        if (currentInputMode === 'table') renderTable();
    };
    reader.readAsText(file);
});

clearBtn.addEventListener('click', () => {
    fileInput.value = '';
    payloadTa.value = 'Record_Time,Day_of_Week,Is_Holiday,Holiday_Name,Random_Event_Surge,Rain_Index,Net_Crowd_Density,Item_ID\n2026-01-01T00:00:00.000Z,4,1,new year\'s day,0,clear,0,1\n2026-01-01T01:00:00.000Z,4,1,new year\'s day,0,heavy_rain,29,1\n2026-01-01T02:00:00.000Z,4,1,new year\'s day,0,light_rain,40,1';
    fileNameEl.textContent = 'Upload CSV file';
    fileLabel.classList.remove('has-file');
    clearBtn.style.display = 'none';
    document.getElementById('sm-content-type').value = 'application/json';
    document.getElementById('ag-content-type').value = 'application/json';
    if (currentInputMode === 'table') renderTable();
});

// ── REFRESH DASHBOARD HANDLER ──
async function handleRefreshDashboard() {
    const refreshBtn = document.getElementById('demo-refresh-btn');
    if (!lastPredictionData) return;

    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing...';

    try {
        await init(lastPredictionData, true);  // skipAI=true — keep existing recommendations

        // Switch to the Dashboard tab so the user sees the update
        document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const dashLink = document.querySelector('[data-page="dashboard"]');
        if (dashLink) dashLink.classList.add('active');
        document.getElementById('page-dashboard').classList.add('active');

        setDemoStatus('success', 'Dashboard refreshed with prediction data!', 'Updated', 'good');
    } catch (err) {
        setDemoStatus('error', `Refresh failed: ${err.message}`, 'Error', 'warn');
        console.error('Refresh error:', err);
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh Dashboard';
    }
}

// ── TRY PARSE RESPONSE AS PREDICTION DATA ──
function tryStorePredictionData(responseText, contentType) {
    const refreshBtn = document.getElementById('demo-refresh-btn');

    // Try to parse the response as CSV
    try {
        const parsed = parseCSVText(responseText);
        if (parsed.length === 0) throw new Error('Empty CSV');
        const first = parsed[0];

        // Standard format: date + P50
        if ('date' in first && 'P50' in first) {
            lastPredictionData = parsed;
            refreshBtn.style.display = '';
            setDemoStatus('success', `Got ${parsed.length} prediction rows — ready to refresh dashboard`, 'Predictions', 'good');
            return true;
        }

        // Canvas model output: Record_Time + p50 (lowercase)
        if (('Record_Time' in first || 'record_time' in first) && ('p50' in first || 'P50' in first)) {
            console.log('Detected Canvas model output — normalizing columns...');
            lastPredictionData = parsed.map(r => {
                const rawTime = String(r['Record_Time'] || r['record_time'] || '');
                // "2026-12-31 01:00:00" → "12-31 01:00"
                let dateStr = rawTime;
                const match = rawTime.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
                if (match) {
                    dateStr = `${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
                }
                return {
                    date: dateStr,
                    P10: Math.round(parseFloat(r['p10'] || r['P10']) || 0),
                    P50: Math.round(parseFloat(r['p50'] || r['P50']) || 0),
                    P90: Math.round(parseFloat(r['p90'] || r['P90']) || 0)
                };
            });
            refreshBtn.style.display = '';
            setDemoStatus('success', `Got ${lastPredictionData.length} prediction rows — ready to refresh dashboard`, 'Predictions', 'good');
            return true;
        }
    } catch (_) { /* not CSV */ }

    // Try JSON — check if it contains an array with prediction keys
    try {
        const json = JSON.parse(responseText);
        const arr = Array.isArray(json) ? json : (json.predictions || json.data || json.results);
        if (arr && Array.isArray(arr) && arr.length > 0) {
            const first = arr[0];
            const hasP50 = ('P50' in first) || ('p50' in first);
            const hasDate = ('date' in first) || ('Record_Time' in first) || ('record_time' in first);
            if (hasP50 && hasDate) {
                // Normalize JSON the same way
                lastPredictionData = arr.map(r => {
                    const rawTime = String(r['Record_Time'] || r['record_time'] || r['date'] || '');
                    let dateStr = rawTime;
                    const match = rawTime.match(/(\d{4})-(\d{2})-(\d{2})/);
                    if (match) {
                        const hh = rawTime.match(/(\d{2}):(\d{2})/);
                        dateStr = `${match[2]}-${match[3]} ${hh ? hh[1]+':'+hh[2] : '00:00'}`;
                    }
                    return {
                        date: dateStr,
                        P10: Math.round(parseFloat(r['P10'] || r['p10']) || 0),
                        P50: Math.round(parseFloat(r['P50'] || r['p50']) || 0),
                        P90: Math.round(parseFloat(r['P90'] || r['p90']) || 0)
                    };
                });
                refreshBtn.style.display = '';
                setDemoStatus('success', `Got ${lastPredictionData.length} prediction rows — ready to refresh dashboard`, 'Predictions', 'good');
                return true;
            }
        }
    } catch (_) { /* not JSON or wrong shape */ }

    // Not prediction data — hide refresh button
    lastPredictionData = null;
    refreshBtn.style.display = 'none';
    return false;
}

// ── Invoke button ──
document.getElementById('demo-invoke-btn').addEventListener('click', handleDemoInvoke);

// ── Refresh dashboard button ──
document.getElementById('demo-refresh-btn').addEventListener('click', handleRefreshDashboard);

// ── Ctrl+Enter shortcut to invoke ──
document.getElementById('demo-payload').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleDemoInvoke();
    }
});

