from typing import List

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, util
from groq import Groq

app = FastAPI()

# CORS para permitir llamadas desde tu HTML/JS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Servir archivos estáticos (index.html, app.js)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def read_index():
    return FileResponse("static/index.html")


# Cargar modelo de embeddings al iniciar
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

#========================
# Datos y embeddings base
#========================

# Modelo de datos para un ticket
class Ticket(BaseModel):
    id: int
    title: str
    description: str


# Lista de tickets de ejemplo
tickets: List[Ticket] = [
    Ticket(
        id=1,
        title="No puedo iniciar sesión",
        description="El usuario no puede acceder con su contraseña",
    ),
    Ticket(
        id=2,
        title="Error en pago con tarjeta",
        description="Falla al procesar el pago con tarjeta de crédito",
    ),
    Ticket(
        id=3,
        title="Página no carga",
        description="La página principal se queda en blanco al abrir",
    ),
    Ticket(
        id=4,
        title="Restablecer contraseña",
        description="Solicitud para cambiar o restablecer la contraseña",
    ),
]

# Embeddings precalculados de los tickets (usaremos título + descripción)
ticket_texts = [f"{t.title}. {t.description}" for t in tickets]
ticket_embeddings = model.encode(ticket_texts, convert_to_tensor=True)

#==========
# Endpoints
#==========

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/embed")
async def embed_text(text: str):
    embedding = model.encode(text).tolist()
    return {"embedding_dim": len(embedding)}


class SearchRequest(BaseModel):
    query: str
    top_k: int = 3


@app.post("/search")
async def search_tickets(body: SearchRequest):
    query_embedding = model.encode(body.query, convert_to_tensor=True)
    scores = util.cos_sim(query_embedding, ticket_embeddings)[0]

    top_k = min(body.top_k, len(tickets))
    top_results = scores.topk(k=top_k)

    results = []
    for score, idx in zip(top_results.values, top_results.indices):
        t = tickets[int(idx)]
        results.append(
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "score": float(score),
            }
        )

    return {"results": results}

#===========================
# Integración con Groq (LLM)
#===========================

class AnswerRequest(BaseModel):
    query: str
    top_k: int = 3

@app.post("/answer_with_groq")
async def answer_with_groq(body: AnswerRequest):

    """
    1) Busca tickets similares con embeddings
    2) Llama al LLM de Groq para generar una respuesta sugerida.
    """
    #1. Buscar tickets similares (reutilizamos la lógica anterior)
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
                "score": float(score),
            }
        )

    # 2. Construir prompt para Groq
    context_lines = []
    for t in similar_tickets:
        context_lines.append(
            f"- Ticket {t['id']}: {t['title']} -> {t['description']} (score: {t['score']:.3f})"
        )
    context_text = "\n".join(context_lines)

    prompt = (
        "Eres un agente de soporte técnico.\n"
        "El usuario describe el siguiente problema:\n"
        f"{body.query}\n\n"
        "Estos son tickets de soporte previos que podrían ser relevantes:\n"
        f"{context_text}\n\n"
        "Usando estos tickets como referencia, explica brevemente cuál parece "
        "ser la causa más problable del problema y propon casos claros que el usuario pueda seguir para resolverlo."
    )

    # 3. Llamar a Groq (necesitas GROQ_API_KEY en variables de entorno)
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        #En desarrollo, devolvemos un mensaje claro si falta la API key
        return{
            "error": "GROQ_API_KEY no está configurada en las variables de entorno.",
            "similar_tickets": similar_tickets,
        }
    
    client = Groq(api_key=api_key)

    completion = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": "Eres un agente de soporte técnico útil."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
    )

    #Extraer el contenido de forma segura
    answer_text = ""
    if completion.choices and completion.choices[0].message:
        answer_text = completion.choices[0].message.content or ""

    #print("GROQ RAW COMPLETION:", completion)
    #answer_text = completion.choices[0].message.content if completion.choices else ""

    return {
        "anser": answer_text,
        "similar_tickets": similar_tickets,
    }