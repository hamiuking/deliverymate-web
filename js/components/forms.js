// public/js/components/forms.js
// Minimal form helper to collect values.

export function getFormData(formEl) {
  const data = {};
  const fd = new FormData(formEl);
  for (const [k, v] of fd.entries()) {
    // Trim strings; keep empty as '' so backend optional fields behave as expected.
    data[k] = (typeof v === 'string') ? v.trim() : v;
  }
  return data;
}
