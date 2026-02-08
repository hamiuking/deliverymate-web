// public/js/components/jsonviewer.js

import { pretty } from "../utils.js";

export function jsonViewer(obj) {
  return `<pre>${pretty(obj)}</pre>`;
}