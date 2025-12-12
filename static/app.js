// app.js
(() => {
  const q = (sel) => document.querySelector(sel);
  const escapeHTML = (str) => {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/\"/g,'&quot;')
      .replace(/'/g,'&#39;');
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

    const table = document.createElement('table');
    table.classList.add('results-table');

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>ID</th>
        <th>Título</th>
        <th>Categoría</th>
        <th>Score</th>
        <th>Descripción</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    items.forEach((item) => {
      const id = escapeHTML(String(item.id ?? 'N/A'));
      const title = escapeHTML(String(item.title ?? 'Sin título'));
      const desc = escapeHTML(String(item.description ?? ''));
      const category = escapeHTML(String(item.category ?? '—'));
      const score = typeof item.score === 'number' ? item.score.toFixed(3) : '—';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${id}</td>
        <td>${title}</td>
        <td>${category}</td>
        <td>${score}</td>
        <td>${desc}</td>
      `;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);
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
    if (!query) {
      resultsDiv.textContent = 'Por favor escribe una descripción del problema.';
      queryEl?.focus();
      return;
    }

    setLoading(resultsDiv, true, 'Buscando tickets…');
    disable(searchBtn, true);
    try {
      const res = await postJSON('/search', { query, top_k: 3 });
      if (!res.ok) {
        resultsDiv.textContent = `Error (HTTP ${res.status}).`;
        return;
      }
      const data = await res.json();
      setLoading(resultsDiv, false);
      renderList(resultsDiv, Array.isArray(data?.results) ? data.results : []);
    } catch (e) {
      console.error(e);
      setLoading(resultsDiv, false);
      resultsDiv.textContent = 'Ocurrió un error al llamar a la API.';
    } finally {
      disable(searchBtn, false);
    }
  }

  async function answerWithGroq() {
    const queryEl = q('#query');
    const resultsDiv = q('#results');
    const answerDiv = q('#groqAnswer');
    const answerBtn = q('#answerBtn');
    const query = (queryEl?.value ?? '').trim();

    answerDiv.innerHTML = '';
    resultsDiv.innerHTML = '';
    if (!query) {
      answerDiv.textContent = 'Por favor escribe una descripción del problema.';
      queryEl?.focus();
      return;
    }

    setLoading(answerDiv, true, 'Consultando LLM…');
    disable(answerBtn, true);
    try {
      const res = await postJSON('/answer_with_groq', { query, top_k: 3 });
      const data = await res.json();
      setLoading(answerDiv, false);

      if (data.error) {
        answerDiv.textContent = data.error;
        return;
      }

      // texto del modelo
      answerDiv.textContent = data.answer || 'No se recibió respuesta del modelo.';

      // tickets similares
      if (Array.isArray(data.similar_tickets) && data.similar_tickets.length > 0) {
        renderList(resultsDiv, data.similar_tickets);
      }
    } catch (e) {
      console.error(e);
      setLoading(answerDiv, false);
      answerDiv.textContent = 'Ocurrió un error al llamar a la API de Groq.';
    } finally {
      disable(answerBtn, false);
    }
  }

  // Stream con polyfill POST + formateo de tabla
  function answerWithGroqStream() {
    const ans = q('#groqAnswer');
    const resDiv = q('#results');
    const btn = q('#answerStreamBtn');
    const queryEl = q('#query');
    const query = (queryEl?.value ?? '').trim();

    ans.textContent = '';
    // NO vaciamos resDiv aquí; se llenará cuando llegue el evento "meta"

    if (!query) {
      ans.textContent = 'Por favor escribe una descripción del problema.';
      queryEl?.focus();
      return;
    }

    disable(btn, true);
    setLoading(ans, true, 'Consultando LLM (stream)…');

    ans.innerHTML = '<pre class="groq-output"></pre>';
    const pre = ans.querySelector('pre');

    const es = new EventSourcePolyfill('/answer_with_groq_stream', {
      payload: { query, top_k: 3 },
    });

    let metaHandled = false;

es.onmessage = (ev) => {
  if (!metaHandled) return;
  let chunk = ev.data;
  if (!chunk) return;

  if (/^ERROR:/.test(chunk)) {
    setLoading(ans, false);
    if (pre) pre.textContent = chunk;
    es.close();
    disable(btn, false);
    return;
  }

  setLoading(ans, false);
  if (!pre) return;

  // 1) Unificar espacios alrededor de barras
  let text = chunk.replace(/\s*\|\s*/g, '|');

  // 2) Insertar salto doble antes de la tabla si viene pegada a la frase
  text = text.replace(
    /(\.|!|\?)\s*\|Paso\|Acción\|Detalle\|/i,
    '$1\n\n|Paso|Acción|Detall e|'
  );

  // 3) Poner cabecera y separador en sus propias líneas
  text = text.replace(/\|Paso\|Acción\|Detalle\|/i, '\n| Paso | Acción | Detalle |\n| --- | --- | --- |\n');

  // 4) Cada fila `|1|...|...|...|` en su propia línea
  text = text.replace(/\|(1|2|3|4|5)\|/g, '\n| $1 |');

  pre.textContent += text;
};


    es.addEventListener('meta', (ev) => {
      metaHandled = true;
      try {
        const meta = JSON.parse(ev.data);
        renderList(resDiv, meta?.similar_tickets ?? []);
      } catch {
        // si falla JSON, no mostramos tabla
      }
    });

    es.addEventListener('done', () => {
      es.close();
      disable(btn, false);
    });

    es.onerror = (err) => {
      console.error(err);
      es.close();
      disable(btn, false);
      setLoading(ans, false);
      if (pre) {
        pre.textContent = 'Error en stream.';
      } else {
        ans.textContent = 'Error en stream.';
      }
    };
  }

  // Polyfill SSE POST
  class EventSourcePolyfill {
    constructor(url, { payload }) {
      this._listeners = {};
      this.onmessage = null;
      this.onerror = null;
      const encoder = new TextDecoder('utf-8');
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.getReader();
          let buf = '';
          const pump = () =>
            reader.read().then(({ done, value }) => {
              if (done) {
                this._emit('done', '');
                return;
              }
              buf += encoder.decode(value, { stream: true });
              const parts = buf.split('\n\n');
              buf = parts.pop();
              parts.forEach((block) => {
                const lines = block.split('\n');
                let event = 'message';
                let data = '';
                lines.forEach((line) => {
                  if (line.startsWith('event:')) event = line.slice(6).trim();
                  else if (line.startsWith('data:')) data += line.slice(5).trim();
                });
                if (event === 'message' && this.onmessage)
                  this.onmessage({ data });
                this._emit(event, data);
              });
              return pump();
            }).catch((err) => {
              if (this.onerror) this.onerror(err);
            });
          return pump();
        })
        .catch((err) => {
          if (this.onerror) this.onerror(err);
        });
    }
    addEventListener(ev, cb) {
      (this._listeners[ev] ??= []).push(cb);
    }
    _emit(ev, data) {
      (this._listeners[ev] || []).forEach((cb) => cb({ data }));
    }
    close() {
      // el stream terminará por sí solo
    }
  }

  // Un solo DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    const searchBtn = q('#searchBtn');
    const answerBtn = q('#answerBtn');
    const answerStreamBtn = q('#answerStreamBtn');

    searchBtn?.addEventListener('click', searchTickets);
    answerBtn?.addEventListener('click', answerWithGroq);
    answerStreamBtn?.addEventListener('click', answerWithGroqStream);
  });
})();
