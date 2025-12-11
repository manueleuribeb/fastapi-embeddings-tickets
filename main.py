from typing import List
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, util
from groq import Groq

# Instancia principal de la aplicación FastAPI
app = FastAPI()

# =========================
# Configuración de CORS
# =========================
# Permite que tu frontend (HTML/JS) pueda llamar a la API desde el navegador.
# Aquí se aceptan todas las procedencias, métodos y cabeceras para simplificar.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Archivos estáticos
# =========================
# Monta la carpeta "static" en la ruta /static, para servir index.html, app.js, styles.css, etc.
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def read_index():
    """
    Devuelve la página principal (frontend) cuando el usuario entra a "/".
    """
    return FileResponse("static/index.html")


# =========================
# Modelo de embeddings
# =========================
# Carga el modelo pre-entrenado de SentenceTransformers que genera vectores
# para textos; se usa para medir similitud entre tickets y la consulta.
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

# =========================
# Datos base: tickets
# =========================

class Ticket(BaseModel):
    """
    Representa un ticket de soporte con id, título y descripción.
    """
    id: int
    title: str
    description: str
    category: str


# Lista de tickets de ejemplo que se usarán para buscar similitud.
tickets: List[Ticket] = [
    Ticket(
        id=1,
        title="No puedo iniciar sesión",
        description="El usuario no puede acceder con su contraseña",
        category="Autenticación",
    ),
    Ticket(
        id=2,
        title="Error en pago con tarjeta",
        description="Falla al procesar el pago con tarjeta de crédito",
        category="Pagos",
    ),
    Ticket(
        id=3,
        title="Página no carga",
        description="La página principal se queda en blanco al abrir",
        category="Rendimiento",
    ),
    Ticket(
        id=4,
        title="Restablecer contraseña",
        description="Solicitud para cambiar o restablecer la contraseña",
        category="Autenticación",
    ),
    Ticket(
        id=5,
        title="Error al actualizar perfil",
        description="No se guardan los cambios en la configuración del usuario",
        category="Cuenta",
    ),
    Ticket(
        id=6,
        title="No llegan correos de verificación",
        description="El usuario no recibe el correo para activar su cuenta",
        category="Notificaciones",
    ),
]

# Precalcula los embeddings de todos los tickets (título + descripción)
# para no recalcularlos en cada petición.
ticket_texts = [f"{t.title}. {t.description}" for t in tickets]
ticket_embeddings = model.encode(ticket_texts, convert_to_tensor=True)

# ==========
# Endpoints
# ==========

@app.get("/health")
async def health():
    """
    Endpoint simple para comprobar que la API está viva.
    Devuelve {"status": "ok"}.
    """
    return {"status": "ok"}


@app.post("/embed")
async def embed_text(text: str):
    """
    Devuelve solo la dimensión del embedding de un texto dado.
    Útil para probar que el modelo funciona.
    """
    embedding = model.encode(text).tolist()
    return {"embedding_dim": len(embedding)}


class SearchRequest(BaseModel):
    """
    Cuerpo de la petición para /search.
    - query: texto que describe el problema.
    - top_k: cuántos tickets similares devolver.
    """
    query: str
    top_k: int = 3


@app.post("/search")
async def search_tickets(body: SearchRequest):
    """
    Dada una consulta de usuario, calcula su embedding y devuelve
    los top_k tickets más similares, con su score de similitud.
    """
    # Embedding de la consulta
    query_embedding = model.encode(body.query, convert_to_tensor=True)

    # Matriz de similitud coseno entre la consulta y todos los tickets
    scores = util.cos_sim(query_embedding, ticket_embeddings)[0]

    # Número máximo de resultados (no puede superar el nº de tickets)
    top_k = min(body.top_k, len(tickets))

    # Obtiene los índices y valores de los mejores scores
    top_results = scores.topk(k=top_k)

    # Construye la lista de resultados en formato JSON
    results = []
    for score, idx in zip(top_results.values, top_results.indices):
        t = tickets[int(idx)]
        results.append(
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "category": t.category,
                "score": float(score),
            }
        )

    return {"results": results}


# ===========================
# Integración con Groq (LLM)
# ===========================

class AnswerRequest(BaseModel):
    """
    Cuerpo de la petición para /answer_with_groq.
    Reutiliza query y top_k, igual que /search.
    """
    query: str
    top_k: int = 3


@app.post("/answer_with_groq")
async def answer_with_groq(body: AnswerRequest):
    """
    1) Busca los tickets más similares usando embeddings.
    2) Llama al LLM de Groq para generar una respuesta de soporte
       en lenguaje natural, usando esos tickets como contexto.
    """
    # -------- 1. Buscar tickets similares --------
    query_embedding = model.encode(body.query, convert_to_tensor=True)
    scores = util.cos_sim(query_embedding, ticket_embeddings)[0]

    top_k = min(body.top_k, len(tickets))
    top_results = scores.topk(k=top_k)

    similar_tickets = []
    for score, idx in zip(top_results.values, top_results.indices):
        t = tickets[int(idx)]
        similar_tickets.append(
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "category": t.category,
                "score": float(score),
            }
        )

    # -------- 2. Construir el prompt para Groq --------
    context_lines = []
    for t in similar_tickets:
        context_lines.append(
            f"- Ticket {t['id']}: {t['title']} -> {t['description']} (score: {t['score']:.3f})"
        )

    context_text = "\n".join(context_lines)

    prompt = (
        "Eres un agente de soporte técnico. Responde en español.\n"
        "Tu tarea es analizar el problema del usuario y los tickets similares.\n\n"
        "Problema del usuario:\n"
        f"{body.query}\n\n"
        "Tickets similares:\n"
        f"{context_text}\n\n"
        "Devuelve una respuesta breve y concreta siguiendo estas reglas:\n"
        "1. Primero identifica la causa más probable del problema en una frase.\n"
        "2. Luego propon de 2 a 4 pasos de solución muy claros.\n"
        "3. Formatea la salida como una tabla Markdown con las columnas:\n"
        "   | Paso | Acción | Detalle |\n"
        "Cada fila debe ser un paso numerado.\n"
        "No incluyas explicaciones fuera de la tabla."
    )

    # -------- 3. Llamar a la API de Groq --------
    # Obtiene la API key desde la variable de entorno GROQ_API_KEY.
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        # Si no está configurada, devuelve un error legible y los tickets encontrados.
        return {
            "error": "GROQ_API_KEY no está configurada en las variables de entorno.",
            "similar_tickets": similar_tickets,
        }

    # Cliente oficial de Groq
    client = Groq(api_key=api_key)

    # Llamada al modelo de chat (similar a OpenAI Chat Completions)
    completion = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": "Eres un agente de soporte técnico útil."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
    )

    # -------- 4. Extraer el texto de la respuesta --------
    answer_text = ""
    if completion.choices and completion.choices[0].message:
        answer_text = completion.choices[0].message.content or ""

    # Devuelve tanto la respuesta generada como los tickets usados como contexto
    return {
        "answer": answer_text,
        "similar_tickets": similar_tickets,
    }
