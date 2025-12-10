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
        top_k: 3,
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

    const list = document.createElement("ul");

    data.results.forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<strong>[${item.id}] ${item.title}</strong> ` +
        `(score: ${item.score.toFixed(3)})<br/>` +
        `${item.description}`;
      list.appendChild(li);
    });

    resultsDiv.appendChild(list);
  } catch (err) {
    console.error(err);
    resultsDiv.textContent = "Ocurrió un error al llamar a la API.";
  }
}

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
        top_k: 3,
      }),
    });

    const data = await response.json();

    if (data.error) {
      answerDiv.textContent = data.error;
      return;
    }

    // Mostrar respuesta del LLM
    answerDiv.textContent = data.answer || "No se recibió respuesta del modelo.";

    // Mostrar también los tickets usados
    if (data.similar_tickets && data.similar_tickets.length > 0) {
      const list = document.createElement("ul");
      data.similar_tickets.forEach((item) => {
        const li = document.createElement("li");
        li.innerHTML =
          `<strong>[${item.id}] ${item.title}</strong> ` +
          `(score: ${item.score.toFixed(3)})<br/>` +
          `${item.description}`;
        list.appendChild(li);
      });
      resultsDiv.appendChild(list);
    }
  } catch (err) {
    console.error(err);
    answerDiv.textContent = "Ocurrió un error al llamar a la API de Groq.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("searchBtn");
  btn.addEventListener("click", searchTickets);

  const answerBtn = document.getElementById("answerBtn");
  if (answerBtn) {
    answerBtn.addEventListener("click", answerWithGroq);
  }
});
