// app.js
(() => {
  const $ = (sel) => document.querySelector(sel);
  const API_BASE = ""; // mismo host / puerto del backend

  // --- Tabla de tickets similares ---
  function buildTicketsTable(tickets) {
    if (!tickets || tickets.length === 0) {
      return "<p>No se encontraron tickets similares.</p>";
    }

    const rows = tickets
      .map(
        (t) => `
      <tr>
        <td>${t.id}</td>
        <td>${t.title}</td>
        <td>${t.description}</td>
        <td>${t.category}</td>
        <td>${t.score.toFixed(3)}</td>
      </tr>`
      )
      .join("");

    return `
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Título</th>
            <th>Descripción</th>
            <th>Categoría</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // --- Botón: Buscar tickets similares ---
  async function onSearchClick() {
    const query = $("#query").value.trim();
    if (!query) return;

    $("#similar-tickets-table").innerHTML = "<p>Buscando…</p>";

    const res = await fetch(`${API_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: 3 }),
    });

    const data = await res.json();
    // SOLO actualiza la sección de tickets similares
    $("#similar-tickets-table").innerHTML = buildTicketsTable(
      data.results || []
    );
  }

  // --- Botón: Generar respuesta con Groq ---
  async function onGroqClick() {
    const query = $("#query").value.trim();
    if (!query) return;

    $("#groq-answer-table").innerHTML = "<p>Generando respuesta…</p>";

    const res = await fetch(`${API_BASE}/answer_with_groq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: 3 }),
    });

    const data = await res.json();

    if (data.error) {
      // SOLO actualiza la sección de respuesta generada
      $("#groq-answer-table").innerHTML = `<p>Error: ${data.error}</p>`;
      return;
    }

    // data.answer ya es una tabla HTML -> no tocar
    $("#groq-answer-table").innerHTML = data.answer;
    // No cambiamos la tabla de "Tickets similares" aquí
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#btn-search").addEventListener("click", onSearchClick);
    $("#btn-groq").addEventListener("click", onGroqClick);
  });
})();
