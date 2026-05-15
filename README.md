# CourseTube

A local website that turns YouTube playlists into structured courses and lets signed-in users manage and watch those courses inside the app.

## Run

```powershell
npm start
```

This starts the Python backend in `main.py` and serves the existing frontend from `public/`.

Open `http://localhost:3000`.

## Database

The backend uses Postgres through `DATABASE_URL`.

Set `DATABASE_URL` in your local or deployment environment before using Postgres-backed auth and course storage.

The app creates these tables automatically:

- `users`
- `sessions`
- `courses`

## YouTube API

Embedded playback works through public YouTube video IDs. For reliable playlist importing, start the server with a YouTube Data API key:

```powershell
$env:YOUTUBE_API_KEY="your_api_key_here"
npm start
```

Without `YOUTUBE_API_KEY`, the server tries a no-key public playlist import and falls back to pasted video titles when YouTube blocks or changes page metadata.

## Current auth and storage

Sign in/sign up is currently a local prototype using `localStorage`. Courses, progress, and notes are saved in the browser on this machine. A production version should replace this with real authentication and a database.
