"""Persistent lesson memory (mirrors src/memory/lessonStore.ts).

Firestore when FIRESTORE_ENABLED=true with a project configured, otherwise
in-memory. Write methods never throw; read failures mean "no memory".
"""

from __future__ import annotations

import os
from typing import Optional

from logger import logger


def merge_lessons(existing: list[dict], loaded: list[dict], cap: int) -> list[dict]:
    seen = {f"{e.get('at')}|{e.get('prompt')}" for e in existing}
    merged = [*existing]
    for e in loaded:
        key = f"{e.get('at')}|{e.get('prompt')}"
        if key not in seen:
            seen.add(key)
            merged.append(e)
    merged.sort(key=lambda e: e.get("at") or "")
    return merged[-max(1, cap):]


class InMemoryLessonStore:
    backend = "memory"

    def __init__(self):
        self._lessons: dict[str, list[dict]] = {}
        self._stats: dict[str, dict] = {}

    def load_lessons(self, room_id: str, limit: int) -> list[dict]:
        return (self._lessons.get(room_id) or [])[-max(1, limit):]

    def append_lesson(self, room_id: str, entry: dict) -> None:
        lst = self._lessons.get(room_id) or []
        lst.append(entry)
        self._lessons[room_id] = lst[-50:]

    def load_stats(self, room_id: str) -> Optional[dict]:
        return self._stats.get(room_id)

    def save_stats(self, room_id: str, stats: dict) -> None:
        self._stats[room_id] = stats


class FirestoreLessonStore:
    backend = "firestore"

    def __init__(self, project_id: str):
        from firebase_admin import credentials, firestore, initialize_app, get_apps  # type: ignore

        database_id = (os.environ.get("FIRESTORE_DATABASE_ID") or "(default)").strip() or "(default)"
        if not get_apps():
            inline = os.environ.get("FIRESTORE_SERVICE_ACCOUNT_JSON")
            if inline:
                import json as _json
                initialize_app(credentials.Certificate(_json.loads(inline)), {"projectId": project_id})
            else:
                initialize_app(options={"projectId": project_id})
        self._db = firestore.client(database_id=database_id) if database_id != "(default)" else firestore.client()

    def load_lessons(self, room_id: str, limit: int) -> list[dict]:
        snap = self._db.collection("agent-lessons").where("roomId", "==", room_id).limit(max(1, limit) * 2).get()
        entries = [{
            "prompt": str(d.get("prompt") or "")[:160],
            "requester": str(d.get("requester") or "Classmate")[:64],
            "turns": int(d.get("turns") or 0),
            "model": str(d.get("model") or ""),
            "at": str(d.get("at") or ""),
        } for doc in snap for d in [doc.to_dict() or {}]]
        entries.sort(key=lambda e: e["at"])
        return entries[-max(1, limit):]

    def append_lesson(self, room_id: str, entry: dict) -> None:
        try:
            from firebase_admin import firestore as _fs
            self._db.collection("agent-lessons").add(
                {**entry, "roomId": room_id, "createdAt": _fs.SERVER_TIMESTAMP})
        except Exception as exc:  # noqa: BLE001
            logger.warning("appendLesson failed room=%s: %s", room_id, exc)

    def load_stats(self, room_id: str) -> Optional[dict]:
        doc = self._db.collection("agent-room-stats").document(room_id).get()
        if not doc.exists:
            return None
        d = doc.to_dict() or {}
        return {"tasksCompleted": int(d.get("tasksCompleted") or 0),
                "tasksFailed": int(d.get("tasksFailed") or 0),
                "toolCalls": int(d.get("toolCalls") or 0),
                "totalTurns": int(d.get("totalTurns") or 0),
                "updatedAt": str(d.get("updatedAt") or "")}

    def save_stats(self, room_id: str, stats: dict) -> None:
        try:
            self._db.collection("agent-room-stats").document(room_id).set(stats, merge=True)
        except Exception as exc:  # noqa: BLE001
            logger.warning("saveStats failed room=%s: %s", room_id, exc)


def create_lesson_store():
    enabled = (os.environ.get("FIRESTORE_ENABLED") or "").strip().lower()
    project_id = (os.environ.get("FIRESTORE_PROJECT_ID") or "").strip()
    if enabled in ("true", "1", "yes"):
        if not project_id:
            logger.warning("FIRESTORE_ENABLED but no FIRESTORE_PROJECT_ID — using in-memory lesson store")
            return InMemoryLessonStore()
        try:
            store = FirestoreLessonStore(project_id)
            logger.info("Firestore lesson store enabled project=%s", project_id)
            return store
        except Exception as exc:  # noqa: BLE001
            logger.warning("Firestore init failed — using in-memory lesson store: %s", exc)
            return InMemoryLessonStore()
    return InMemoryLessonStore()
