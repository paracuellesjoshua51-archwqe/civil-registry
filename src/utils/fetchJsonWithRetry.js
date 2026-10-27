import { apiFetch } from "../services/apiFetch";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET-style JSON fetch with a short retry. Surfaces the server's error message. */
export async function fetchJsonWithRetry(url, { signal, retries = 2, delay = 500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await apiFetch(url, { signal });
      let body = null;
      try { body = await res.json(); } catch { /* non-JSON body */ }
      if (!res.ok) throw new Error(body?.error || `Server responded with ${res.status}`);
      return body;
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      lastErr = err;
      if (attempt < retries) await sleep(delay * (attempt + 1));
    }
  }
  throw lastErr;
}