from __future__ import annotations

import json
import math
import mimetypes
import os
import re
import secrets
import hashlib
import hmac
import base64
import sqlite3
from datetime import datetime, timezone
from contextlib import contextmanager
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"


def load_env_file() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()

PORT = int(os.environ.get("PORT", "3000"))
DATABASE_URL = os.environ.get("DATABASE_URL", "")
ADMIN_VIEWER_ENABLED = os.environ.get("ADMIN_VIEWER_ENABLED", "0").lower() in {"1", "true", "yes"}
SQLITE_FALLBACK_PATH = ROOT / "coursetube_dev.db"
HEADERS = {
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
}

COURSE_THEMES = [
    {
        "match": re.compile(r"javascript|typescript|react|node|python|program|code|web|css|html", re.I),
        "track": "Build Track",
        "outcome": "ship a working technical project",
        "project": "Create a small portfolio-ready implementation using the playlist concepts",
    },
    {
        "match": re.compile(r"math|calculus|algebra|statistics|physics|chemistry|biology|science", re.I),
        "track": "Concept Mastery Track",
        "outcome": "solve problems with a repeatable method",
        "project": "Build a worked-problem notebook with explanations and checkpoints",
    },
    {
        "match": re.compile(r"\b(design|figma|ui|ux|photoshop|illustrator|motion|animation)\b", re.I),
        "track": "Studio Track",
        "outcome": "produce a polished visual artifact",
        "project": "Create a case-study piece that applies the core techniques",
    },
    {
        "match": re.compile(r"business|marketing|sales|startup|finance|product|management", re.I),
        "track": "Operator Track",
        "outcome": "turn the lessons into a practical operating plan",
        "project": "Draft a strategy brief with metrics, risks, and next actions",
    },
]


def get_psycopg():
    try:
        import psycopg
        from psycopg.rows import dict_row

        return psycopg, dict_row
    except ImportError as error:
        raise RuntimeError("Postgres driver missing. Run: pip install -r requirements.txt") from error


def db_connect():
    if not DATABASE_URL:
        connection = sqlite3.connect(SQLITE_FALLBACK_PATH)
        connection.row_factory = sqlite3.Row
        return connection
    psycopg, dict_row = get_psycopg()
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


@contextmanager
def db_cursor(db):
    cursor = db.cursor()
    try:
        yield cursor
    finally:
        cursor.close()


def init_db() -> None:
    with db_connect() as db:
        if not DATABASE_URL:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS courses (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    course_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                """
            )
            return

        with db_cursor(db) as cursor:
            cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                user_id BIGINT NOT NULL,
                course_json JSONB NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
            )


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return f"pbkdf2_sha256${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, salt_raw, digest_raw = stored.split("$", 2)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_raw)
        expected = base64.b64decode(digest_raw)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def public_user(row: dict) -> dict:
    return {"id": row["id"], "name": row["name"], "email": row["email"]}


def param(sql: str) -> str:
    return sql if DATABASE_URL else sql.replace("%s", "?")


def course_to_db(course: dict):
    if DATABASE_URL:
        from psycopg.types.json import Jsonb

        return Jsonb(course)
    return json.dumps(course)


def course_from_db(value):
    if isinstance(value, str):
        return json.loads(value)
    return value or {}


def admin_database_snapshot() -> dict:
    with db_connect() as db:
        with db_cursor(db) as cursor:
            cursor.execute("SELECT id, name, email, created_at FROM users ORDER BY id DESC LIMIT 100")
            users = cursor.fetchall()
            cursor.execute(
                """
                SELECT sessions.user_id, users.email, sessions.created_at, sessions.token
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                ORDER BY sessions.created_at DESC
                LIMIT 100
                """
            )
            sessions = cursor.fetchall()
            cursor.execute(
                """
                SELECT id, user_id, course_json, created_at, updated_at
                FROM courses
                ORDER BY updated_at DESC
                LIMIT 100
                """
            )
            rows = cursor.fetchall()

    courses = []
    for row in rows:
        course = course_from_db(row["course_json"])
        summary = course.get("summary", {}) if isinstance(course, dict) else {}
        courses.append(
            {
                "id": row["id"],
                "user_id": row["user_id"],
                "title": course.get("title", "") if isinstance(course, dict) else "",
                "lessons": summary.get("lessons", 0),
                "modules": summary.get("modules", 0),
                "updated_at": row["updated_at"],
                "course": course,
            }
        )

    clean_users = [dict(row) for row in users]
    clean_sessions = [dict(row) | {"token_preview": row["token"][:10]} for row in sessions]
    for session in clean_sessions:
        session.pop("token", None)
    return {"users": clean_users, "sessions": clean_sessions, "courses": courses}


def get_cookie(headers, name: str) -> str:
    cookie_header = headers.get("Cookie", "")
    for part in cookie_header.split(";"):
        if "=" not in part:
            continue
        key, value = part.strip().split("=", 1)
        if key == name:
            return urllib.parse.unquote(value)
    return ""


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_json(url: str) -> dict:
    return json.loads(fetch_text(url))


def parse_playlist_id(value: str = "") -> str:
    value = value.strip()
    parsed = urllib.parse.urlparse(value)
    if parsed.query:
        playlist_id = urllib.parse.parse_qs(parsed.query).get("list", [""])[0]
        if playlist_id:
            return playlist_id
    match = re.search(r"[?&]list=([a-zA-Z0-9_-]+)", value)
    return match.group(1) if match else ""


def parse_duration_to_minutes(duration: str = "") -> float:
    if duration.startswith("PT"):
        match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
        if not match:
            return 12
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)
        seconds = int(match.group(3) or 0)
        return max(3, hours * 60 + minutes + seconds / 60)

    parts = [int(part) for part in duration.split(":") if part.strip().isdigit()]
    if not parts:
        return 12
    if len(parts) == 1:
        return max(3, parts[0])
    if len(parts) == 2:
        return max(3, parts[0] + parts[1] / 60)
    return max(3, parts[0] * 60 + parts[1] + parts[2] / 60)


def format_iso_duration(duration: str = "") -> str:
    minutes = round(parse_duration_to_minutes(duration))
    hours = minutes // 60
    rest = minutes % 60
    if hours and rest:
        return f"{hours}:{rest:02d}"
    if hours:
        return f"{hours}:00"
    return f"{rest}:00"


def extract_balanced_object(source: str, marker: str) -> str | None:
    marker_index = source.find(marker)
    if marker_index == -1:
        return None
    start = source.find("{", marker_index)
    if start == -1:
        return None

    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(source)):
        char = source[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    return None


def walk(value, visitor):
    if isinstance(value, dict):
        visitor(value)
        for item in value.values():
            walk(item, visitor)
    elif isinstance(value, list):
        for item in value:
            walk(item, visitor)


def extract_text(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if "simpleText" in value:
            return value["simpleText"]
        if "runs" in value:
            return "".join(run.get("text", "") for run in value["runs"])
    return ""


def extract_playlist_videos(initial_data: dict) -> list[dict]:
    videos: list[dict] = []
    seen: set[str] = set()

    def visitor(node):
        renderer = node.get("playlistVideoRenderer")
        if not renderer:
            return
        video_id = renderer.get("videoId")
        if not video_id or video_id in seen:
            return
        title = extract_text(renderer.get("title"))
        if not title:
            return
        seen.add(video_id)
        videos.append(
            {
                "id": video_id,
                "title": title,
                "duration": extract_text(renderer.get("lengthText")),
                "url": f"https://www.youtube.com/watch?v={video_id}",
            }
        )

    walk(initial_data, visitor)
    return videos


def fetch_playlist_videos_with_api(playlist_id: str) -> dict:
    key = os.environ.get("YOUTUBE_API_KEY", "")
    videos: list[dict] = []
    page_token = ""

    for _ in range(4):
        params = {
            "part": "snippet,contentDetails",
            "maxResults": "50",
            "playlistId": playlist_id,
            "key": key,
        }
        if page_token:
            params["pageToken"] = page_token
        data = fetch_json(f"https://www.googleapis.com/youtube/v3/playlistItems?{urllib.parse.urlencode(params)}")
        for item in data.get("items", []):
            video_id = item.get("contentDetails", {}).get("videoId") or item.get("snippet", {}).get("resourceId", {}).get("videoId")
            title = item.get("snippet", {}).get("title")
            if not video_id or not title or title in {"Deleted video", "Private video"}:
                continue
            videos.append({"id": video_id, "title": title, "duration": "", "url": f"https://www.youtube.com/watch?v={video_id}"})
        page_token = data.get("nextPageToken", "")
        if not page_token:
            break

    if not videos:
        return {"videos": [], "source": "manual", "warning": "The YouTube Data API did not return public videos for this playlist."}

    enrich_video_durations(videos, key)
    return {"videos": videos, "source": "youtube-api", "warning": ""}


def enrich_video_durations(videos: list[dict], key: str) -> None:
    for index in range(0, len(videos), 50):
        batch = videos[index : index + 50]
        params = {
            "part": "contentDetails",
            "id": ",".join(video["id"] for video in batch),
            "key": key,
        }
        try:
            data = fetch_json(f"https://www.googleapis.com/youtube/v3/videos?{urllib.parse.urlencode(params)}")
        except Exception:
            continue
        durations = {item.get("id"): item.get("contentDetails", {}).get("duration", "") for item in data.get("items", [])}
        for video in batch:
            duration = durations.get(video["id"])
            if duration:
                video["duration"] = format_iso_duration(duration)


def fetch_playlist_videos(playlist_url: str) -> dict:
    playlist_id = parse_playlist_id(playlist_url)
    if not playlist_id:
        return {"videos": [], "source": "manual", "warning": "No playlist id was found in the YouTube link."}

    if os.environ.get("YOUTUBE_API_KEY"):
        try:
            result = fetch_playlist_videos_with_api(playlist_id)
            if result["videos"] or result["warning"]:
                return result
        except Exception as error:
            return {"videos": [], "source": "manual", "warning": f"YouTube Data API failed: {error}"}

    try:
        html = fetch_text(f"https://www.youtube.com/playlist?list={urllib.parse.quote(playlist_id)}&hl=en")
        raw = extract_balanced_object(html, "var ytInitialData =") or extract_balanced_object(html, 'window["ytInitialData"] =')
        if not raw:
            return {"videos": [], "source": "manual", "warning": "The playlist metadata was not readable from YouTube's page."}
        videos = extract_playlist_videos(json.loads(raw))
        return {
            "videos": videos,
            "source": "youtube" if videos else "manual",
            "warning": "" if videos else "No public playlist videos were found. Private or hidden playlists cannot be imported.",
        }
    except Exception as error:
        return {"videos": [], "source": "manual", "warning": f"Could not reach YouTube from this server: {error}"}


def clean_video_description(description: str = "") -> str:
    cleaned = (
        description.replace("\r", "")
        .replace("►", " ")
    )
    cleaned = re.sub(r"https?://\S+", " ", cleaned)
    cleaned = re.split(r"\n\s*(?:connect|follow|instagram|telegram|discord|subscribe|links)\b", cleaned, flags=re.I)[0]
    lines = []
    for line in cleaned.split("\n"):
        line = re.sub(r"^\s*\d{1,2}:\d{2}(?::\d{2})?\s*", "", line).strip()
        if line:
            lines.append(line)
    return re.sub(r"\s+", " ", ". ".join(lines)).strip()


def fetch_video_description(video_id: str) -> str:
    if not re.match(r"^[a-zA-Z0-9_-]{6,}$", video_id or ""):
        return ""
    html = fetch_text(f"https://www.youtube.com/watch?v={urllib.parse.quote(video_id)}&hl=en")
    raw = extract_balanced_object(html, "var ytInitialPlayerResponse =") or extract_balanced_object(html, "ytInitialPlayerResponse")
    if not raw:
        return ""
    player = json.loads(raw)
    return clean_video_description(player.get("videoDetails", {}).get("shortDescription", ""))


def split_sentences(text: str = "") -> list[str]:
    normalized = re.sub(r"\s+", " ", text)
    return [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", normalized) if len(sentence.strip()) > 30]


def summarize_text(text: str, lesson_title: str = "") -> dict:
    sentences = split_sentences(text)
    stop_words = set("the a an and or but to of in is are was were for with on at by from this that it as be you your we they he she them our have has had will can could should would about into through then than so if not do does did".split())
    words = re.findall(r"[a-z0-9]+", text.lower())
    frequencies: dict[str, int] = {}
    for word in words:
        if len(word) < 4 or word in stop_words:
            continue
        frequencies[word] = frequencies.get(word, 0) + 1

    ranked = []
    for index, sentence in enumerate(sentences):
        score = sum(frequencies.get(word, 0) for word in re.findall(r"[a-z0-9]+", sentence.lower()))
        ranked.append({"sentence": sentence, "index": index, "score": score})
    top = sorted(sorted(ranked, key=lambda item: item["score"], reverse=True)[:5], key=lambda item: item["index"])
    key_terms = [word for word, _ in sorted(frequencies.items(), key=lambda item: item[1], reverse=True)[:8]]

    return {
        "title": lesson_title or "Video summary",
        "overview": top[0]["sentence"] if top else f"This video covers {lesson_title or 'the selected lesson'} using the available description.",
        "points": [item["sentence"] for item in top[1:5]],
        "keyTerms": key_terms,
        "transcriptLength": len(words),
    }


def normalize_manual_titles(titles: str = "") -> list[dict]:
    videos = []
    for index, line in enumerate(titles.splitlines()):
        title = re.sub(r"^\s*\d+[\).:-]?\s*", "", line).strip()
        if title:
            videos.append({"id": f"manual-{index + 1}", "title": title, "duration": "", "url": ""})
    return videos


def pick_theme(title_text: str) -> dict:
    for theme in COURSE_THEMES:
        if theme["match"].search(title_text):
            return theme
    return {
        "track": "Guided Learning Track",
        "outcome": "move from fundamentals to independent practice",
        "project": "Create a final reference guide and applied capstone from the playlist",
    }


def title_case_from_playlist(playlist_url: str, videos: list[dict]) -> str:
    first_title = videos[0]["title"] if videos else "Playlist"
    cleaned = re.sub(r"\|.*$", "", first_title)
    cleaned = re.sub(r"#\d+", "", cleaned)
    cleaned = re.sub(r"\b(part|episode|lesson)\s*\d+\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return f"{cleaned or parse_playlist_id(playlist_url) or 'Playlist'} Course"


def module_name(index: int, lessons: list[dict]) -> str:
    text = " ".join(lesson["title"] for lesson in lessons)
    candidates = [
        (re.compile(r"intro|start|beginner|basics|fundamental|overview", re.I), "Foundations"),
        (re.compile(r"setup|install|environment|tool|workflow", re.I), "Setup and Workflow"),
        (re.compile(r"project|build|create|implement|app|website", re.I), "Applied Build"),
        (re.compile(r"advanced|optimize|deploy|scale|production", re.I), "Advanced Practice"),
        (re.compile(r"review|summary|revision|practice|exercise", re.I), "Practice and Review"),
    ]
    for pattern, name in candidates:
        if pattern.search(text):
            return name
    return f"Module {index + 1}"


def create_module_goal(index: int, module_count: int, theme: dict) -> str:
    if index == 0:
        return f"Establish the core vocabulary, tools, and mental models for the {theme['track'].lower()}."
    if index == module_count - 1:
        return "Consolidate the playlist into an applied result that can be reviewed or shared."
    return "Connect the previous lessons into usable patterns through guided practice."


def create_checkpoint(index: int, module_count: int, theme: dict) -> str:
    if index == module_count - 1:
        return theme["project"] if theme["project"].endswith(".") else f"{theme['project']}."
    return "Write a one-page summary and complete one practice task before continuing."


def create_lesson_focus(title: str, module_index: int, lesson_index: int) -> str:
    lower = title.lower()
    if re.search(r"intro|overview|start", lower):
        return "Understand the purpose, vocabulary, and expected outcome."
    if re.search(r"setup|install|environment", lower):
        return "Prepare the working environment and confirm everything is ready."
    if re.search(r"project|build|create|implement", lower):
        return "Apply the concept in a concrete working example."
    if re.search(r"error|debug|fix|problem", lower):
        return "Identify failure cases and learn the troubleshooting path."
    if re.search(r"advanced|optimize|deploy", lower):
        return "Move from basic use to stronger real-world execution."
    return "Capture the key idea and define success criteria for the course." if module_index == 0 and lesson_index == 0 else "Extract the core concept, then turn it into a short practice task."


def create_activity(title: str, _module_index: int, lesson_index: int) -> str:
    if re.search(r"project|build|create|implement", title, re.I):
        return "Pause after the lesson and recreate the main result without looking."
    if re.search(r"setup|install|environment", title, re.I):
        return "Document your setup steps and note any issues you had to solve."
    if re.search(r"practice|exercise|problem", title, re.I):
        return "Complete the exercise twice: once with guidance and once independently."
    return "Write three bullet notes and one question to answer before the next lesson." if lesson_index % 2 == 0 else "Make a tiny example or explanation that proves you understood the lesson."


def build_course(playlist_url: str, videos: list[dict], pace: str = "standard", requested_modules=0, warning: str = "", source: str = "manual") -> dict:
    theme = pick_theme(" ".join(video["title"] for video in videos))
    lesson_count = len(videos)
    total_minutes = sum(parse_duration_to_minutes(video.get("duration", "")) for video in videos)
    module_count = max(1, min(lesson_count or 1, int(requested_modules or 0) or math.ceil((lesson_count or 6) / 5)))
    chunk_size = math.ceil((lesson_count or 1) / module_count)
    modules = []

    for index in range(module_count):
        module_videos = videos[index * chunk_size : index * chunk_size + chunk_size]
        lessons = []
        for lesson_index, video in enumerate(module_videos):
            number = index * chunk_size + lesson_index + 1
            video_id = video.get("id", "")
            lessons.append(
                {
                    "number": number,
                    "id": video_id,
                    "title": video["title"],
                    "duration": video.get("duration") or "Self-paced",
                    "url": video.get("url", ""),
                    "embedUrl": "" if video_id.startswith("manual-") else f"https://www.youtube.com/embed/{video_id}",
                    "focus": create_lesson_focus(video["title"], index, lesson_index),
                    "activity": create_activity(video["title"], index, lesson_index),
                }
            )

        modules.append(
            {
                "number": index + 1,
                "title": module_name(index, lessons),
                "goal": create_module_goal(index, module_count, theme),
                "checkpoint": create_checkpoint(index, module_count, theme),
                "lessons": lessons,
            }
        )

    weeks = max(1, math.ceil(module_count / 2)) if pace == "fast" else module_count * 2 if pace == "deep" else module_count
    return {
        "title": title_case_from_playlist(playlist_url, videos),
        "source": source,
        "warning": warning,
        "summary": {
            "lessons": lesson_count,
            "modules": module_count,
            "estimatedHours": max(1, round(total_minutes / 60)),
            "pace": pace,
            "weeks": weeks,
        },
        "objective": f"By the end, learners should be able to {theme['outcome']} using a structured sequence of lessons, practice tasks, and review checkpoints.",
        "prerequisites": [
            "Basic comfort with the subject area",
            "A notebook or workspace for exercises",
            "Enough uninterrupted time to complete each module checkpoint",
        ],
        "modules": modules,
        "capstone": {
            "title": "Final Capstone",
            "brief": theme["project"],
            "deliverables": [
                "A concise notes pack covering each module",
                "A completed practical artifact or solved problem set",
                "A reflection listing what to revisit and what to learn next",
            ],
        },
    }


class CourseTubeHandler(BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: dict, headers: dict | None = None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(raw or "{}")

    def current_user(self) -> dict | None:
        token = get_cookie(self.headers, "ct_session")
        if not token:
            return None
        with db_connect() as db:
            with db_cursor(db) as cursor:
                cursor.execute(
                    param("""
                    SELECT users.id, users.name, users.email
                    FROM sessions
                    JOIN users ON users.id = sessions.user_id
                    WHERE sessions.token = %s
                    """),
                    (token,),
                )
                row = cursor.fetchone()
                return public_user(row) if row else None

    def require_user(self) -> dict | None:
        user = self.current_user()
        if not user:
            self.send_json(401, {"error": "Sign in first."})
            return None
        return user

    def create_session_response(self, user: dict):
        token = secrets.token_urlsafe(32)
        with db_connect() as db:
            with db_cursor(db) as cursor:
                cursor.execute(
                    param("INSERT INTO sessions (token, user_id, created_at) VALUES (%s, %s, %s)"),
                    (token, user["id"], now_iso()),
                )
        self.send_json(
            200,
            {"user": user},
            {
                "Set-Cookie": f"ct_session={urllib.parse.quote(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000"
            },
        )

    def do_POST(self):
        try:
            if self.path == "/api/auth/signup":
                body = self.read_json()
                name = str(body.get("name", "")).strip() or str(body.get("email", "")).split("@")[0]
                email = str(body.get("email", "")).strip().lower()
                password = str(body.get("password", ""))
                if not email or "@" not in email or len(password) < 6:
                    self.send_json(422, {"error": "Use a valid email and a password with at least 6 characters."})
                    return
                try:
                    with db_connect() as db:
                        with db_cursor(db) as cursor:
                            if DATABASE_URL:
                                cursor.execute(
                                    "INSERT INTO users (name, email, password_hash, created_at) VALUES (%s, %s, %s, %s) RETURNING id, name, email",
                                    (name, email, hash_password(password), now_iso()),
                                )
                                user = public_user(cursor.fetchone())
                            else:
                                cursor.execute(
                                    "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
                                    (name, email, hash_password(password), now_iso()),
                                )
                                cursor.execute("SELECT id, name, email FROM users WHERE email = ?", (email,))
                                user = public_user(cursor.fetchone())
                    self.create_session_response(user)
                except Exception as error:
                    if "duplicate key" in str(error).lower() or "unique" in str(error).lower():
                        self.send_json(409, {"error": "An account already exists for this email."})
                    else:
                        raise
                return

            if self.path == "/api/auth/signin":
                body = self.read_json()
                email = str(body.get("email", "")).strip().lower()
                password = str(body.get("password", ""))
                with db_connect() as db:
                    with db_cursor(db) as cursor:
                        cursor.execute(param("SELECT id, name, email, password_hash FROM users WHERE email = %s"), (email,))
                        row = cursor.fetchone()
                if not row or not verify_password(password, row["password_hash"]):
                    self.send_json(401, {"error": "Invalid email or password."})
                    return
                self.create_session_response(public_user(row))
                return

            if self.path == "/api/auth/signout":
                token = get_cookie(self.headers, "ct_session")
                if token:
                    with db_connect() as db:
                        with db_cursor(db) as cursor:
                            cursor.execute(param("DELETE FROM sessions WHERE token = %s"), (token,))
                self.send_json(200, {"ok": True}, {"Set-Cookie": "ct_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})
                return

            if self.path == "/api/courses":
                user = self.require_user()
                if not user:
                    return
                body = self.read_json()
                course = body.get("course")
                if not isinstance(course, dict) or not course.get("localId"):
                    self.send_json(422, {"error": "Missing course payload."})
                    return
                now = now_iso()
                with db_connect() as db:
                    with db_cursor(db) as cursor:
                        cursor.execute(
                            param("""
                            INSERT INTO courses (id, user_id, course_json, created_at, updated_at)
                            VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT (id) DO UPDATE SET course_json = EXCLUDED.course_json, updated_at = EXCLUDED.updated_at
                            """) if DATABASE_URL else """
                            INSERT INTO courses (id, user_id, course_json, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(id) DO UPDATE SET course_json = excluded.course_json, updated_at = excluded.updated_at
                            """,
                            (course["localId"], user["id"], course_to_db(course), now, now),
                        )
                self.send_json(200, {"course": course})
                return

            if self.path == "/api/course":
                user = self.require_user()
                if not user:
                    return
                body = self.read_json()
                manual_videos = normalize_manual_titles(body.get("videoTitles", ""))
                fetched = {"videos": [], "source": "manual", "warning": ""}
                if body.get("playlistUrl"):
                    fetched = fetch_playlist_videos(body["playlistUrl"])
                videos = fetched["videos"] or manual_videos
                if not videos:
                    self.send_json(422, {"error": "Add a public YouTube playlist link or paste video titles manually."})
                    return
                self.send_json(
                    200,
                    build_course(
                        playlist_url=body.get("playlistUrl", ""),
                        videos=videos,
                        pace=body.get("pace", "standard"),
                        requested_modules=body.get("modules") or 0,
                        warning="" if fetched["videos"] else fetched.get("warning", ""),
                        source=fetched.get("source", "manual"),
                    ),
                )
                return

            if self.path == "/api/video-summary":
                body = self.read_json()
                description = fetch_video_description(body.get("videoId", ""))
                if not description:
                    self.send_json(422, {"error": "No readable YouTube video description was available for this lesson."})
                    return
                self.send_json(200, {**summarize_text(description, body.get("title", "")), "source": "youtube-description"})
                return

            if self.path == "/api/transcript-summary":
                body = self.read_json()
                transcript = re.sub(r"\s+", " ", str(body.get("transcript", ""))).strip()
                if len(transcript) < 120:
                    self.send_json(422, {"error": "Paste a longer transcript so the summary has enough content to work from."})
                    return
                self.send_json(200, {**summarize_text(transcript, body.get("title", "")), "source": "pasted-transcript"})
                return

            self.send_response(404)
            self.end_headers()
        except Exception as error:
            self.send_json(500, {"error": str(error) or "Something went wrong."})

    def do_GET(self):
        if self.path == "/api/admin/db":
            if not ADMIN_VIEWER_ENABLED or self.client_address[0] not in {"127.0.0.1", "::1"}:
                self.send_json(404, {"error": "Not found."})
                return
            try:
                self.send_json(200, admin_database_snapshot())
            except Exception as error:
                self.send_json(500, {"error": str(error)})
            return

        if self.path == "/api/auth/me":
            user = self.current_user()
            self.send_json(200, {"user": user})
            return

        if self.path == "/api/courses":
            user = self.require_user()
            if not user:
                return
            with db_connect() as db:
                with db_cursor(db) as cursor:
                    cursor.execute(
                        param("SELECT course_json FROM courses WHERE user_id = %s ORDER BY updated_at DESC"),
                        (user["id"],),
                    )
                    courses = [course_from_db(row["course_json"]) for row in cursor.fetchall()]
            self.send_json(200, {"courses": courses})
            return

        requested = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if requested == "/":
            requested = "/index.html"
        target = (PUBLIC_DIR / requested.lstrip("/")).resolve()
        if not str(target).startswith(str(PUBLIC_DIR.resolve())):
            self.send_response(403)
            self.end_headers()
            return
        if not target.exists() or not target.is_file():
            self.send_response(404)
            self.end_headers()
            return

        content = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *args):
        return

    def do_DELETE(self):
        try:
            if self.path.startswith("/api/courses/"):
                user = self.require_user()
                if not user:
                    return
                course_id = urllib.parse.unquote(self.path.removeprefix("/api/courses/"))
                with db_connect() as db:
                    with db_cursor(db) as cursor:
                        cursor.execute(param("DELETE FROM courses WHERE id = %s AND user_id = %s"), (course_id, user["id"]))
                self.send_json(200, {"ok": True})
                return
            self.send_response(404)
            self.end_headers()
        except Exception as error:
            self.send_json(500, {"error": str(error) or "Something went wrong."})


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), CourseTubeHandler)
    print(f"CourseTube Python server is running at http://localhost:{PORT}")
    server.serve_forever()
