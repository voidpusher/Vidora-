# Vidora

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

## Google Sign-In

Google sign-in is available when these environment variables are set:

```text
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
```

Add this authorized redirect URI in Google Cloud Console:

```text
https://your-domain.com/api/auth/google/callback
```

For the current Vercel deployment, use:

```text
https://coursetube-seven.vercel.app/api/auth/google/callback
```

## Current auth and storage

Sign in/sign up uses backend session cookies. Courses, progress, and notes are saved through the Python backend in Postgres when `DATABASE_URL` is configured.
