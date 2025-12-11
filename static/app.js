// ===============================
// Búsqueda de tickets por embeddings
// ===============================
async function searchTickets() {
  const queryEl = document.getElementById("query");
  const resultsDiv = document.getElementById("results");

  const query = queryEl.value.trim();
  resultsDiv.innerHTML = "";

  if (!query) {
    resultsDiv.textContent = "Por favor escribe una descripción del problema.";
    return;
  }

  try {
    const response = await fetch("/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query,
        top_k: 5, // número de tickets similares a mostrar
      }),
    });

    if (!response.ok) {
      resultsDiv.textContent =
        "Error en la búsqueda (HTTP " + response.status + ").";
      return;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      resultsDiv.textContent = "No se encontraron tickets similares.";
      return;
    }

    // Crear tabla de resultados
    const table = document.createElement("table");
    table.classList.add("results-table");

    const thead = document.createElement("thead");
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

    const tbody = document.createElement("tbody");

    data.results.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.id}</td>
        <td>${item.title}</td>
        <td>${item.category || "-"}</td>
        <td>${item.score.toFixed(3)}</td>
        <td>${item.description}</td>
      `;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    resultsDiv.appendChild(table);
  } catch (err) {
    console.error(err);
    resultsDiv.textContent = "Ocurrió un error al llamar a la API.";
  }
}

// ===============================
// Generar respuesta con Groq (LLM)
// ===============================
async function answerWithGroq() {
  const queryEl = document.getElementById("query");
  const resultsDiv = document.getElementById("results");
  const answerDiv = document.getElementById("groqAnswer");

  const query = queryEl.value.trim();
  answerDiv.innerHTML = "";
  resultsDiv.innerHTML = "";

  if (!query) {
    answerDiv.textContent = "Por favor escribe una descripción del problema.";
    return;
  }

  try {
    const response = await fetch("/answer_with_groq", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query,
        top_k: 5,
      }),
    });

    const data = await response.json();
    console.log("GROQ DATA:", data);

    if (data.error) {
      answerDiv.textContent = data.error;
      return;
    }

    // Mostrar respuesta del LLM (Markdown → HTML)
    if (data.answer) {
      // marked viene del script CDN en index.html
      answerDiv.innerHTML = marked.parse(data.answer);
    } else {
      answerDiv.textContent = "No se recibió respuesta del modelo.";
    }

    // Tabla con tickets usados como contexto
    if (data.similar_tickets && data.similar_tickets.length > 0) {
      const table = document.createElement("table");
      table.classList.add("results-table");

      const thead = document.createElement("thead");
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

      const tbody = document.createElement("tbody");

      data.similar_tickets.forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${item.id}</td>
          <td>${item.title}</td>
          <td>${item.category || "-"}</td>
          <td>${item.score.toFixed(3)}</td>
          <td>${item.description}</td>
        `;
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      resultsDiv.appendChild(table);
    }
  } catch (err) {
    console.error(err);
    answerDiv.textContent = "Ocurrió un error al llamar a la API de Groq.";
  }
}

// ===============================
// Registro de eventos al cargar la página
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("searchBtn");
  btn.addEventListener("click", searchTickets);

  const answerBtn = document.getElementById("answerBtn");
  if (answerBtn) {
    answerBtn.addEventListener("click", answerWithGroq);
  }
});