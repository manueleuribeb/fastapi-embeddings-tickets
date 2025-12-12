
// app.js
(() => {
  const q = (sel) => document.querySelector(sel);
  const escapeHTML = (str) => {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');
  };

  const disable = (el, on) => { if (el) el.disabled = !!on; };
  const setLoading = (el, isLoading, label='Cargando…') => {
    if (!el) return;
    if (isLoading) {
      el.setAttribute('aria-busy','true');
      el.innerHTML = `<div class="spinner" role="status" aria-live="polite">${label}</div>`;
    } else {
      el.removeAttribute('aria-busy');
    }
  };

  const renderList = (container, items) => {
    if (!Array.isArray(items) || items.length === 0) {
      container.textContent = 'No se encontraron tickets similares.';
      return;
    }
    const ul = document.createElement('ul');
    ul.setAttribute('role','list');
    items.forEach((item) => {
      const id = escapeHTML(String(item.id ?? 'N/A'));
      const title = escapeHTML(String(item.title ?? 'Sin título'));
      const desc = escapeHTML(String(item.description ?? ''));
      const score = (typeof item.score === 'number') ? item.score.toFixed(3) : '—';
      const li = document.createElement('li');
      li.innerHTML = `[#${id}] ${title} <small>(score: ${score})</small><br><div class="desc">${desc}</div>`;
      ul.appendChild(li);
    });
    container.innerHTML = '';
    container.appendChild(ul);
  };

  async function postJSON(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    return res;
  }

  async function searchTickets() {
    const resultsDiv = q('#results');
    const searchBtn = q('#searchBtn');
    const queryEl = q('#query');
    const query = (queryEl?.value ?? '').trim();

    resultsDiv.innerHTML = '';
    if (!query) { resultsDiv.textContent = 'Por favor escribe una descripción del problema.'; queryEl?.focus(); return; }

    setLoading(resultsDiv, true, 'Buscando tickets…');
    disable(searchBtn, true);
    try {
      const res = await postJSON('/search', { query, top_k: 3 });
      if (!res.ok) { resultsDiv.textContent = `Error (HTTP ${res.status}).`; return; }
      const data = await res.json();
      setLoading(resultsDiv, false);
      renderList(resultsDiv, Array.isArray(data?.results) ? data.results : []);
    } catch (e) {
      console.error(e); setLoading(resultsDiv, false);
      resultsDiv.textContent = 'Ocurrió un error al llamar a la API.';
    } finally { disable(searchBtn, false); }
  }

  function answerWithGroqStream() {
    const ans = q('#groqAnswer');
    const resDiv = q('#results');
    const btn = q('#answerBtn');
    const queryEl = q('#query');
    const query = (queryEl?.value ?? '').trim();

    ans.textContent = '';
    resDiv.innerHTML = '';
    if (!query) { ans.textContent = 'Por favor escribe una descripción del problema.'; queryEl?.focus(); return; }

    disable(btn, true); setLoading(ans, true, 'Consultando LLM (stream)…');

    const es = new EventSourcePolyfill('/answer_with_groq_stream', {
      payload: { query, top_k: 3 },
    });

    let metaHandled = false;
    es.onmessage = (ev) => {
      if (!metaHandled) { return; }
      const chunk = ev.data;
      if (!chunk) return;
      if (/^ERROR:/.test(chunk)) {
        setLoading(ans, false); ans.textContent = chunk; es.close(); disable(btn, false); return;
      }
      setLoading(ans, false);
      ans.innerHTML += escapeHTML(chunk);
    };
    es.addEventListener('meta', (ev) => {
      metaHandled = true;
      try {
        const meta = JSON.parse(ev.data);
        renderList(resDiv, meta?.similar_tickets ?? []);
      } catch (_) {}
    });
    es.addEventListener('done', () => { es.close(); disable(btn, false); });
    es.onerror = (err) => { console.error(err); es.close(); disable(btn, false); setLoading(ans, false); ans.textContent = 'Error en stream.'; };
  }

  // Polyfill básico de SSE POST usando fetch + ReadableStream
  class EventSourcePolyfill {
    constructor(url, { payload }) {
      this._listeners = {};
      this.onmessage = null; this.onerror = null;
      const encoder = new TextDecoder('utf-8');
      fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.getReader();
          let buf = '';
          const pump = () => reader.read().then(({done, value}) => {
            if (done) { this._emit('done', ''); return; }
            buf += encoder.decode(value, {stream:true});
            const parts = buf.split('\n\n');
            buf = parts.pop();
            parts.forEach(block => {
              const lines = block.split('\n');
              let event = 'message'; let data = '';
              lines.forEach(line => {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                else if (line.startsWith('data:')) data += line.slice(5).trim();
              });
              if (event === 'message' && this.onmessage) this.onmessage({ data });
              this._emit(event, data);
            });
            return pump();
          }).catch(err => { if (this.onerror) this.onerror(err); });
          return pump();
        }).catch(err => { if (this.onerror) this.onerror(err); });
    }
    addEventListener(ev, cb){ (this._listeners[ev] ??= []).push(cb); }
    _emit(ev, data){ (this._listeners[ev]||[]).forEach(cb => cb({ data })); }
    close(){ /* fetch stream finalizará naturalmente */ }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const searchBtn = q('#searchBtn');
    const answerBtn = q('#answerBtn');
    searchBtn?.addEventListener('click', searchTickets);
    answerBtn?.addEventListener('click', answerWithGroqStream);
  });
})();
