from __future__ import annotations

from fastapi import FastAPI
from fastapi import WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .api.routes.live import live_session_socket, router as live_router
from .api.routes.meetings import router as meetings_router
from .database import init_db


app = FastAPI(title="Meeting Recap API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}


app.include_router(meetings_router)
app.include_router(live_router)


@app.websocket("/ws/live/{meeting_id}")
async def websocket_live_session(websocket: WebSocket, meeting_id: str):
    await live_session_socket(websocket, meeting_id)
