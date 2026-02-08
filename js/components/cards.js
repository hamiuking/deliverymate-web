// public/js/components/cards.js

export function card(title, content) {
  return `
    <div class="card">
      <h2>${title}</h2>
      <div>${content}</div>
    </div>
  `;
}