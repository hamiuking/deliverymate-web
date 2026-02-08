// public/js/components/forms.js

// Convert <form> into a plain JS object
export function getFormData(form) {
  const data = {};
  new FormData(form).forEach((v, k) => {
    data[k] = v;
  });
  return data;
}

// Disable a button while an async action runs
export function disableDuringAsync(btn, fn) {
  return async () => {
    btn.disabled = true;
    try {
      await fn();
    } finally {
      btn.disabled = false;
    }
  };
}