// public/js/components/status.js
// UI-only helpers for displaying request + escrow progress.
// No business logic changes: this module only maps existing backend statuses into labels.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function statusPill({ request_status, escrow_status, payout_status }) {
  const rs = (request_status || '').toLowerCase();
  const es = (escrow_status || '').toLowerCase();
  const ps = (payout_status || '').toLowerCase();

  const bits = [];
  if (rs) bits.push(`Job: <strong>${esc(rs)}</strong>`);
  if (es) bits.push(`Escrow: <strong>${esc(es)}</strong>`);
  if (ps) bits.push(`Payout: <strong>${esc(ps)}</strong>`);

  return `<div class="pill">${bits.join(' · ')}</div>`;
}

// Timeline is intentionally simplified to match your fixed escrow policy.
export function timeline({ request_status, escrow_status }) {
  const rs = (request_status || '').toLowerCase();
  const es = (escrow_status || '').toLowerCase();

  const steps = [
    { key: 'open', label: 'Open' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'picked_up', label: 'Picked up' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'pending_release', label: 'Pending release' },
    { key: 'released', label: 'Released' },
  ];

  // Determine current step.
  let current = 'open';
  if (rs === 'cancelled') current = 'cancelled';
  else if (es === 'released') current = 'released';
  else if (es === 'pending_release') current = 'pending_release';
  else if (rs === 'delivered') current = 'delivered';
  else if (rs === 'picked_up') current = 'picked_up';
  else if (rs === 'accepted') current = 'accepted';

  if (current === 'cancelled') {
    return `<div class="timeline"><span class="step active">Cancelled</span></div>`;
  }

  const idx = steps.findIndex(s => s.key === current);
  const html = steps.map((s, i) => {
    const cls = i < idx ? 'step done' : i === idx ? 'step active' : 'step todo';
    return `<span class="${cls}">${esc(s.label)}</span>`;
  }).join('');
  return `<div class="timeline">${html}</div>`;
}

export function nextActionText({ role, request_status, escrow_status }) {
  const rs = (request_status || '').toLowerCase();
  const es = (escrow_status || '').toLowerCase();

  if (rs === 'cancelled') return 'This job is cancelled.';

  if (role === 'sender') {
    if (rs === 'open') return 'Next: review driver offers and accept one offer.';
    if (rs === 'accepted' && es !== 'funded' && es !== 'pending_release' && es !== 'released') {
      return 'Next: fund escrow (Stripe Checkout) to confirm the job.';
    }
    if (rs === 'accepted') return 'Next: wait for pickup and delivery updates.';
    if (rs === 'picked_up') return 'In progress: the driver has picked up the item.';
    if (rs === 'delivered' && es === 'pending_release') {
      return 'Next: confirm delivery to release escrow immediately (auto-release after 24 hours if you do nothing).';
    }
    if (es === 'released') return 'Completed: escrow has been released.';
    if (rs === 'delivered') return 'Delivered: escrow will release after confirmation or auto-release window.';
  }

  if (role === 'driver') {
    if (rs === 'open') return 'Next: submit an offer on an open request.';
    if (rs === 'accepted') return 'Next: mark the job as picked_up when you collect the item.';
    if (rs === 'picked_up') return 'Next: mark the job as delivered once drop-off is complete.';
    if (rs === 'delivered' && es === 'pending_release') return 'Delivered: waiting for sender confirmation (auto-release after 24 hours).';
    if (es === 'released') return 'Completed: escrow released. Payout may take some time to process.';
  }

  return '';
}
