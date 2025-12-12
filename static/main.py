from typing import List, Generator
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, util
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def read_index():
    return FileResponse("static/index.html")


model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


class Ticket(BaseModel):
    id: int
    title: str
    description: str
    category: str


tickets: List[Ticket] = [
    Ticket(id=1, title="No puedo iniciar sesión", description="El usuario no puede acceder con su contraseña", category="Autenticación"),
    Ticket(id=2, title="Error en pago con tarjeta", description="Falla al procesar el pago con tarjeta de crédito", category="Pagos"),
    Ticket(id=3, title="Página no carga", description="La página principal se queda en blanco al abrir", category="Rendimiento"),
    Ticket(id=4, title="Restablecer contraseña", description="Solicitud para cambiar o restablecer la contraseña", category="Autenticación"),
    Ticket(id=5, title="Error al actualizar perfil", description="No se guardan los cambios en la configuración del usuario", category="Cuenta"),
    Ticket(id=6, title="No llegan correos de verificación", description="El usuario no recibe el correo para activar su cuenta", category="Notificaciones"),
]

_ticket_texts = [f"{t.title}. {t.description}" for t in tickets]
_ticket_embeddings = model.encode(_ticket_texts, convert_to_tensor=True)


@app.get("/health")
async def health():
    return {"status": "ok"}


class EmbedBody(BaseModel):
    text: str


@app.post("/embed")
async def embed_text(body: EmbedBody):
    embedding = model.encode(body.text).tolist()
    return {"embedding_dim": len(embedding)}


class SearchRequest(BaseModel):
    query: str
    top_k: int = 3


@app.post("/search")
async def search_tickets(body: SearchRequest):
    query_embedding = model.encode(body.query, convert_to_tensor=True)
    scores = util.cos_sim(query_embedding, _ticket_embeddings)[0]
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
                "category": t.category,
                "score": float(score),
            }
        )
    return {"results": results}


class AnswerRequest(BaseModel):
    query: str
    top_k: int = 3


def build_prompt(query: str, similar_tickets: list[dict]) -> str:
    """
    Construye el mensaje que se enviará al modelo de Groq.
    Incluye el problema del usuario y un resumen de los tickets similares.
    """
    context_lines = [
        f"- Ticket {t['id']} ({t['category']}): {t['title']} -> {t['description']} (score: {t['score']:.3f})"
        for t in similar_tickets
    ]
    context_text = "\n".join(context_lines)

    prompt = (
        "Eres un agente de soporte técnico. Responde siempre en español.\n\n"
        "Tu tarea es analizar el problema actual del usuario y los tickets de soporte previos "
        "para proponer una solución clara y accionable.\n\n"
        "Problema del usuario:\n"
        f"{query}\n\n"
        "Tickets similares encontrados:\n"
        f"{context_text}\n\n"
        "Devuelve la respuesta siguiendo estas reglas:\n"
        "1. Escribe primero UNA sola frase con la causa más probable del problema.\n"
        "2. Deja una línea en blanco.\n"
        "3. Después escribe una tabla en formato Markdown con los pasos de solución.\n"
        "   La tabla debe tener exactamente estas columnas:\n"
        "   | Paso | Acción | Detalle |\n"
        "4. Cada paso debe estar en una fila distinta, con saltos de línea correctos.\n"
        "5. No añadas texto fuera de la frase inicial y la tabla.\n"
    )
    return prompt


MODEL_ID = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
API_KEY = os.environ.get("GROQ_API_KEY")


@app.get("/config")
async def config():
    return {"model": MODEL_ID, "has_key": bool(API_KEY)}


@app.post("/answer_with_groq")
async def answer_with_groq(body: AnswerRequest):
    query_embedding = model.encode(body.query, convert_to_tensor=True)
    scores = util.cos_sim(query_embedding, _ticket_embeddings)[0]
    top_k = min(body.top_k, len(tickets))
    top_results = scores.topk(k=top_k)

    similar_tickets: list[dict] = []
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

    if not API_KEY:
        return JSONResponse(
            status_code=400,
            content={
                "error": "GROQ_API_KEY no está configurada.",
                "similar_tickets": similar_tickets,
            },
        )

    client = Groq(api_key=API_KEY)
    prompt = build_prompt(body.query, similar_tickets)

    try:
        completion = client.chat.completions.create(
            model=MODEL_ID,
            messages=[
                {"role": "system", "content": "Eres un agente de soporte técnico útil."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1024,
        )
        answer_text = completion.choices[0].message.content if completion.choices else ""
        return {"answer": answer_text, "similar_tickets": similar_tickets}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Groq API error: {e}", "similar_tickets": similar_tickets},
        )


@app.post("/answer_with_groq_stream")
async def answer_with_groq_stream(body: AnswerRequest):
    query_embedding = model.encode(body.query, convert_to_tensor=True)
    scores = util.cos_sim(query_embedding, _ticket_embeddings)[0]
    top_k = min(body.top_k, len(tickets))
    top_results = scores.topk(k=top_k)

    similar_tickets: list[dict] = []
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

    if not API_KEY:
        def err_gen() -> Generator[bytes, None, None]:
            yield b"data: ERROR: GROQ_API_KEY no esta configurada\n\n"
            yield b"event: done\n"
            yield b"data: \n\n"

        return StreamingResponse(err_gen(), media_type="text/event-stream")

    client = Groq(api_key=API_KEY)
    prompt = build_prompt(body.query, similar_tickets)

    def sse_gen() -> Generator[bytes, None, None]:
        try:
            completion = client.chat.completions.create(
                model=MODEL_ID,
                messages=[
                    {
                        "role": "system",
                        "content": "Eres un agente de soporte técnico útil.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=1024,
                stream=True,
            )
            import json

            # evento con metadatos (tickets similares)
            yield b"event: meta\n"
            yield f"data: {json.dumps({'similar_tickets': similar_tickets})}\n\n".encode()

            # eventos con texto incremental
            for chunk in completion:
                delta = getattr(chunk.choices[0].delta, "content", None)
                if delta:
                    yield f"data: {delta}\n\n".encode()

            # evento de cierre
            yield b"event: done\n"
            yield b"data: \n\n"
        except Exception as e:
            yield f"data: ERROR: {e}\n\n".encode()
            yield b"event: done\n"
            yield b"data: \n\n"

    return StreamingResponse(sse_gen(), media_type="text/event-stream")
