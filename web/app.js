/* global solanaWeb3 */
const web3 = window.solanaWeb3;
const provider = () => window.phantom?.solana || window.solana;

let owner = null;   // connected wallet pubkey (base58)
let token = null;   // login token for withdrawals
let botAddress = null;

const $ = (id) => document.getElementById(id);
const short = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '—');

// ---- tabs ------------------------------------------------------------
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $(`tab-${t.dataset.tab}`).classList.add('active');
  };
});

// ---- status polling --------------------------------------------------
async function refreshStatus() {
  try {
    const s = await (await fetch('/api/status')).json();
    botAddress = s.botAddress;
    $('balance').textContent = s.balanceSol == null ? '— SOL' : `${s.balanceSol.toFixed(4)} SOL`;
    $('botAddr').textContent = s.botAddress || 'run `npm run setup`';
    $('depAddr').textContent = s.botAddress || '—';
    $('posCount').textContent = s.positions.length;
    $('spentToday').textContent = `spent today: ${s.spentToday.toFixed(3)} / ${s.caps.maxDailySpendSol} SOL`;
    const badge = $('modeBadge');
    badge.textContent = s.killSwitch ? 'KILL SWITCH' : s.live ? 'LIVE' : 'DRY RUN';
    badge.className = 'badge ' + (s.live ? 'live' : 'dry');
    renderPositions(s.positions);
  } catch {}
}
function renderPositions(positions) {
  const body = $('posBody');
  if (!positions.length) { body.innerHTML = '<tr><td colspan="4" class="muted">no open positions</td></tr>'; return; }
  body.innerHTML = positions.map((p) => `<tr>
    <td>${p.symbol || '?'}</td>
    <td class="mono">${short(p.mint)}</td>
    <td>${(p.spentSol ?? 0)} SOL</td>
    <td>${p.confidence != null ? p.confidence.toFixed(2) : '—'}</td></tr>`).join('');
}

// ---- live feed (SSE) -------------------------------------------------
function addLine(ev) {
  const feed = $('feed');
  const time = new Date(ev.ts || Date.now()).toLocaleTimeString();
  let cls = 'line', text = '';
  if (ev.type === 'log') { cls += ` ${ev.level || ''}`; text = ev.msg; }
  else if (ev.type === 'analysis') {
    cls += ' analysis';
    text = `🔎 ${ev.symbol || '?'} → ${ev.action} (conf ${ev.confidence.toFixed(2)}, risk ${ev.risk.toFixed(2)}) — ${ev.reasoning}`;
  } else if (ev.type === 'trade') {
    cls += ` ${ev.side}`;
    text = `${ev.side === 'buy' ? '📈 BUY' : '📉 SELL'} ${ev.symbol || short(ev.mint)}` +
      (ev.amountSol ? ` ${ev.amountSol} SOL` : '') + (ev.dryRun ? ' [dry-run]' : '') +
      (ev.signature ? `  ${ev.signature.slice(0, 8)}…` : '');
  } else return;
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = `<span class="t">${time}</span>${escapeHtml(text)}`;
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  feed.appendChild(el);
  if (atBottom) feed.scrollTop = feed.scrollHeight;
  while (feed.children.length > 400) feed.removeChild(feed.firstChild);
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

const es = new EventSource('/api/events');
es.onmessage = (m) => { try { addLine(JSON.parse(m.data)); if (JSON.parse(m.data).type === 'trade') refreshStatus(); } catch {} };

// ---- connect + login with Phantom ------------------------------------
$('connectBtn').onclick = async () => {
  const p = provider();
  if (!p) { alert('Phantom wallet not found. Install the Phantom browser extension.'); return; }
  try {
    const resp = await p.connect();
    owner = resp.publicKey.toString();
    $('ownerShort').textContent = short(owner);

    // Sign the login message to authorize withdrawals.
    const { message } = await (await fetch('/api/nonce')).json();
    const nonce = message.split('nonce: ')[1];
    const signed = await p.signMessage(new TextEncoder().encode(message), 'utf8');
    const sigB64 = btoa(String.fromCharCode(...signed.signature));
    const r = await (await fetch('/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey: owner, signature: sigB64, nonce }),
    })).json();
    if (r.token) {
      token = r.token;
      $('loginState').textContent = '✓ signed in — withdrawals enabled';
      $('connectBtn').textContent = short(owner);
    } else {
      $('loginState').textContent = 'sign-in failed: ' + (r.error || '');
    }
  } catch (e) {
    $('loginState').textContent = 'connect failed: ' + (e.message || e);
  }
};

// ---- deposit (Phantom signs a transfer to the bot wallet) ------------
$('depositBtn').onclick = async () => {
  const msg = $('depositMsg');
  const p = provider();
  if (!p || !owner) { msg.className = 'msg err'; msg.textContent = 'Connect Phantom first.'; return; }
  const amt = parseFloat($('depositAmt').value);
  if (!(amt > 0)) { msg.className = 'msg err'; msg.textContent = 'Enter an amount.'; return; }
  try {
    msg.className = 'msg'; msg.textContent = 'building transaction…';
    const { blockhash, botAddress: addr } = await (await fetch('/api/blockhash')).json();
    const tx = new web3.Transaction().add(web3.SystemProgram.transfer({
      fromPubkey: new web3.PublicKey(owner),
      toPubkey: new web3.PublicKey(addr),
      lamports: Math.floor(amt * web3.LAMPORTS_PER_SOL),
    }));
    tx.feePayer = new web3.PublicKey(owner);
    tx.recentBlockhash = blockhash;
    const { signature } = await p.signAndSendTransaction(tx);
    msg.className = 'msg ok';
    msg.innerHTML = `✓ sent — <a href="https://solscan.io/tx/${signature}" target="_blank">view</a>`;
    setTimeout(refreshStatus, 4000);
  } catch (e) {
    msg.className = 'msg err'; msg.textContent = 'deposit failed: ' + (e.message || e);
  }
};

// ---- withdraw (server signs from bot wallet -> your wallet) ----------
$('withdrawBtn').onclick = async () => {
  const msg = $('withdrawMsg');
  if (!token) { msg.className = 'msg err'; msg.textContent = 'Connect + sign in with Phantom first.'; return; }
  const amt = parseFloat($('withdrawAmt').value);
  if (!(amt > 0)) { msg.className = 'msg err'; msg.textContent = 'Enter an amount.'; return; }
  try {
    msg.className = 'msg'; msg.textContent = 'withdrawing…';
    const r = await (await fetch('/api/withdraw', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ amountSol: amt }),
    })).json();
    if (r.ok) {
      msg.className = 'msg ok';
      msg.innerHTML = `✓ sent — <a href="https://solscan.io/tx/${r.signature}" target="_blank">view</a>`;
      setTimeout(refreshStatus, 4000);
    } else {
      msg.className = 'msg err'; msg.textContent = 'withdraw failed: ' + (r.error || '');
    }
  } catch (e) {
    msg.className = 'msg err'; msg.textContent = 'withdraw failed: ' + (e.message || e);
  }
};

refreshStatus();
setInterval(refreshStatus, 8000);
