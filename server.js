import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const courseThemes = [
  {
    match: /javascript|typescript|react|node|python|program|code|web|css|html/i,
    track: "Build Track",
    outcome: "ship a working technical project",
    project: "Create a small portfolio-ready implementation using the playlist concepts"
  },
  {
    match: /math|calculus|algebra|statistics|physics|chemistry|biology|science/i,
    track: "Concept Mastery Track",
    outcome: "solve problems with a repeatable method",
    project: "Build a worked-problem notebook with explanations and checkpoints"
  },
  {
    match: /\b(design|figma|ui|ux|photoshop|illustrator|motion|animation)\b/i,
    track: "Studio Track",
    outcome: "produce a polished visual artifact",
    project: "Create a case-study piece that applies the core techniques"
  },
  {
    match: /business|marketing|sales|startup|finance|product|management/i,
    track: "Operator Track",
    outcome: "turn the lessons into a practical operating plan",
    project: "Draft a strategy brief with metrics, risks, and next actions"
  }
];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function parsePlaylistId(value = "") {
  try {
    const url = new URL(value.trim());
    return url.searchParams.get("list") || "";
  } catch {
    const direct = value.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return direct?.[1] || "";
  }
}

function parseDurationToMinutes(duration = "") {
  if (duration.startsWith("PT")) return parseIsoDurationToMinutes(duration);
  const parts = duration.split(":").map((part) => Number(part.trim())).filter(Number.isFinite);
  if (!parts.length) return 12;
  if (parts.length === 1) return Math.max(3, parts[0]);
  if (parts.length === 2) return Math.max(3, parts[0] + parts[1] / 60);
  return Math.max(3, parts[0] * 60 + parts[1] + parts[2] / 60);
}

function parseIsoDurationToMinutes(duration = "") {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 12;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return Math.max(3, hours * 60 + minutes + seconds / 60);
}

function formatIsoDuration(duration = "") {
  const minutes = Math.round(parseIsoDurationToMinutes(duration));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}:${String(rest).padStart(2, "0")}`;
  if (hours) return `${hours}:00`;
  return `${rest}:00`;
}

function extractBalancedObject(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = source.indexOf("{", markerIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") inString = true;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  return null;
}

function decodeEntities(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function captionUrlWithFormat(baseUrl, format) {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", format);
  return url.toString();
}

function parseJsonTranscript(raw) {
  const data = JSON.parse(raw);
  return (data.events || [])
    .flatMap((event) => event.segs || [])
    .map((segment) => segment.utf8 || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseXmlTranscript(raw) {
  const textMatches = [...raw.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => match[1]);
  const paragraphMatches = [...raw.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((match) => match[1].replace(/<s[^>]*>([\s\S]*?)<\/s>/g, "$1"));
  return [...textMatches, ...paragraphMatches]
    .map((chunk) => decodeEntities(chunk.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseVttTranscript(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("WEBVTT") && !line.includes("-->") && !/^\d+$/.test(line.trim()))
    .map((line) => decodeEntities(line.replace(/<[^>]+>/g, "").trim()))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCaptionTrackList(raw) {
  return [...raw.matchAll(/<track\b([^>]*)\/?>/g)].map((match) => {
    const attrs = {};
    for (const attr of match[1].matchAll(/(\w+)="([^"]*)"/g)) {
      attrs[attr[1]] = decodeEntities(attr[2]);
    }
    return attrs;
  });
}

async function fetchTimedTextTranscript(videoId) {
  const listUrl = new URL("https://www.youtube.com/api/timedtext");
  listUrl.searchParams.set("type", "list");
  listUrl.searchParams.set("v", videoId);

  const listResponse = await fetch(listUrl, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    }
  });

  if (!listResponse.ok) return "";

  const tracks = parseCaptionTrackList(await listResponse.text());
  const track = tracks.find((item) => item.lang_code?.startsWith("en") && item.kind !== "asr") ||
    tracks.find((item) => item.lang_code?.startsWith("en")) ||
    tracks[0];

  if (!track?.lang_code) return "";

  const transcriptUrl = new URL("https://www.youtube.com/api/timedtext");
  transcriptUrl.searchParams.set("v", videoId);
  transcriptUrl.searchParams.set("lang", track.lang_code);
  transcriptUrl.searchParams.set("fmt", "json3");
  if (track.name) transcriptUrl.searchParams.set("name", track.name);
  if (track.kind) transcriptUrl.searchParams.set("kind", track.kind);

  const transcriptResponse = await fetch(transcriptUrl, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    }
  });

  if (!transcriptResponse.ok) return "";

  const raw = await transcriptResponse.text();
  try {
    return parseJsonTranscript(raw);
  } catch {
    return parseXmlTranscript(raw) || parseVttTranscript(raw);
  }
}

function walk(value, visitor) {
  if (!value || typeof value !== "object") return;
  visitor(value);
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visitor));
    return;
  }
  Object.values(value).forEach((item) => walk(item, visitor));
}

function extractPlaylistVideos(initialData) {
  const videos = [];
  const seen = new Set();

  walk(initialData, (node) => {
    const renderer = node.playlistVideoRenderer;
    if (!renderer?.videoId || seen.has(renderer.videoId)) return;

    const title = renderer.title?.runs?.map((run) => run.text).join("") || renderer.title?.simpleText;
    if (!title) return;

    seen.add(renderer.videoId);
    videos.push({
      id: renderer.videoId,
      title,
      duration: renderer.lengthText?.simpleText || "",
      url: `https://www.youtube.com/watch?v=${renderer.videoId}`
    });
  });

  return videos;
}

async function fetchPlaylistVideos(playlistUrl) {
  const playlistId = parsePlaylistId(playlistUrl);
  if (!playlistId) {
    return { videos: [], source: "manual", warning: "No playlist id was found in the YouTube link." };
  }

  if (process.env.YOUTUBE_API_KEY) {
    const apiResult = await fetchPlaylistVideosWithApi(playlistId);
    if (apiResult.videos.length || apiResult.warning) return apiResult;
  }

  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`;
  const response = await fetch(url, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    }
  });

  if (!response.ok) {
    return { videos: [], source: "manual", warning: `YouTube returned HTTP ${response.status}.` };
  }

  const html = await response.text();
  const json = extractBalancedObject(html, "var ytInitialData =") || extractBalancedObject(html, "window[\"ytInitialData\"] =");
  if (!json) {
    return { videos: [], source: "manual", warning: "The playlist metadata was not readable from YouTube's page." };
  }

  try {
    const videos = extractPlaylistVideos(JSON.parse(json));
    return {
      videos,
      source: videos.length ? "youtube" : "manual",
      warning: videos.length ? "" : "No public playlist videos were found. Private or hidden playlists cannot be imported."
    };
  } catch {
    return { videos: [], source: "manual", warning: "YouTube metadata could not be parsed." };
  }
}

async function fetchVideoTranscript(videoId) {
  if (!/^[a-zA-Z0-9_-]{6,}$/.test(videoId || "")) {
    return { transcript: "", warning: "This lesson does not have a valid YouTube video id." };
  }

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
  const response = await fetch(watchUrl, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    }
  });

  if (!response.ok) {
    return { transcript: "", warning: `YouTube returned HTTP ${response.status} while loading captions.` };
  }

  const html = await response.text();
  const json = extractBalancedObject(html, "var ytInitialPlayerResponse =") || extractBalancedObject(html, "ytInitialPlayerResponse");
  if (!json) {
    return { transcript: "", warning: "Could not read the video caption metadata from YouTube." };
  }

  let player;
  try {
    player = JSON.parse(json);
  } catch {
    return { transcript: "", warning: "Could not parse YouTube caption metadata." };
  }

  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const track = tracks.find((item) => item.languageCode?.startsWith("en") && !item.kind) ||
    tracks.find((item) => item.languageCode?.startsWith("en")) ||
    tracks[0];

  if (!track?.baseUrl) {
    const timedTextTranscript = await fetchTimedTextTranscript(videoId);
    return timedTextTranscript
      ? { transcript: timedTextTranscript, warning: "" }
      : { transcript: "", warning: "No public captions were found for this YouTube video." };
  }

  const formats = [
    { name: "json3", parse: parseJsonTranscript },
    { name: "srv3", parse: parseXmlTranscript },
    { name: "vtt", parse: parseVttTranscript }
  ];

  for (const format of formats) {
    const captionResponse = await fetch(captionUrlWithFormat(track.baseUrl, format.name), {
      headers: {
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
      }
    });

    if (!captionResponse.ok) continue;

    const raw = await captionResponse.text();
    try {
      const transcript = format.parse(raw);
      if (transcript) return { transcript, warning: "" };
    } catch {
      // Try the next caption format.
    }
  }

  const timedTextTranscript = await fetchTimedTextTranscript(videoId);
  if (timedTextTranscript) return { transcript: timedTextTranscript, warning: "" };

  return {
    transcript: "",
    warning: "YouTube shows transcript metadata for this video, but it does not expose readable transcript text to this server. To summarize this video content, add an audio transcription provider or paste a transcript."
  };
}

function extractTranscriptFromDescription(description = "") {
  const cleaned = description
    .replace(/\r/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .trim();
  const junkPattern = /(subscribe|follow|instagram|telegram|discord|coupon|download|playlist|omnisend|sponsor|affiliate|checkout|click here|channel|material|notes|timestamps|chapters|covered in part|best hindi videos|complete course|learn .* in one video)/i;
  const timestampPattern = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;

  const markers = [
    /(?:transcript|transcription|video transcript)\s*[:\-]\s*/i,
    /(?:today we will|this lecture covers)\s*/i
  ];

  for (const marker of markers) {
    const match = cleaned.match(marker);
    if (!match) continue;
    const after = cleaned.slice((match.index || 0) + match[0].length).trim();
    const withoutChapters = after
      .split(/\n\s*(?:chapters|timestamps|connect|follow|instagram|telegram|discord|subscribe|links)\b/i)[0]
      .split("\n")
      .filter((line) => !timestampPattern.test(line) && !junkPattern.test(line))
      .join("\n")
      .replace(/\n{2,}/g, "\n")
      .trim();
    if (looksLikeTranscriptProse(withoutChapters)) return withoutChapters;
  }

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n/g, " ").trim())
    .filter((part) => part.split(/\s+/).length >= 35)
    .filter((part) => !timestampPattern.test(part))
    .filter((part) => !junkPattern.test(part));

  const combined = paragraphs.slice(0, 5).join(" ");
  return looksLikeTranscriptProse(combined) ? combined : "";
}

function cleanVideoDescription(description = "") {
  return description
    .replace(/\r/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/►/g, " ")
    .split(/\n\s*(?:connect|follow|instagram|telegram|discord|subscribe|links)\b/i)[0]
    .split("\n")
    .map((line) => line.replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim())
    .filter(Boolean)
    .join(". ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeTranscriptProse(text = "") {
  const words = text.split(/\s+/).filter(Boolean);
  const sentenceCount = (text.match(/[.!?]/g) || []).length;
  const timestampCount = (text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || []).length;
  return words.length >= 80 && sentenceCount >= 4 && timestampCount <= 2;
}

async function fetchVideoDescriptionTranscript(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
  const response = await fetch(watchUrl, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    }
  });

  if (!response.ok) return "";
  const html = await response.text();
  const json = extractBalancedObject(html, "var ytInitialPlayerResponse =") || extractBalancedObject(html, "ytInitialPlayerResponse");
  if (!json) return "";

  try {
    const player = JSON.parse(json);
    return cleanVideoDescription(player.videoDetails?.shortDescription || "");
  } catch {
    return "";
  }
}

function splitSentences(text = "") {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30);
}

function summarizeTranscript(transcript, lessonTitle = "") {
  const sentences = splitSentences(transcript);
  const stopWords = new Set("the a an and or but to of in is are was were for with on at by from this that it as be you your we they he she them our have has had will can could should would about into through then than so if not do does did".split(" "));
  const words = transcript.toLowerCase().match(/[a-z0-9]+/g) || [];
  const frequencies = new Map();

  for (const word of words) {
    if (word.length < 4 || stopWords.has(word)) continue;
    frequencies.set(word, (frequencies.get(word) || 0) + 1);
  }

  const ranked = sentences.map((sentence, index) => {
    const score = (sentence.toLowerCase().match(/[a-z0-9]+/g) || [])
      .reduce((sum, word) => sum + (frequencies.get(word) || 0), 0);
    return { sentence, index, score };
  }).sort((a, b) => b.score - a.score).slice(0, 5).sort((a, b) => a.index - b.index);

  const keyTerms = [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);

  const overview = ranked[0]?.sentence || `This video covers ${lessonTitle || "the selected lesson"} using the available transcript.`;
  return {
    title: lessonTitle || "Video summary",
    overview,
    points: ranked.slice(1).map((item) => item.sentence).slice(0, 4),
    keyTerms,
    transcriptLength: words.length
  };
}

async function handleVideoSummaryRequest(request, response) {
  try {
    const body = await readRequestJson(request);
    const transcript = await fetchVideoDescriptionTranscript(body.videoId || "");

    if (!transcript) {
      sendJson(response, 422, {
        error: "No readable YouTube video description was available for this lesson."
      });
      return;
    }

    sendJson(response, 200, {
      ...summarizeTranscript(transcript, body.title || ""),
      source: "youtube-description"
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Could not summarize this video." });
  }
}

async function handleTranscriptSummaryRequest(request, response) {
  try {
    const body = await readRequestJson(request);
    const transcript = String(body.transcript || "").replace(/\s+/g, " ").trim();

    if (transcript.length < 120) {
      sendJson(response, 422, {
        error: "Paste a longer transcript so the summary has enough content to work from."
      });
      return;
    }

    sendJson(response, 200, {
      ...summarizeTranscript(transcript, body.title || ""),
      source: "pasted-transcript"
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Could not summarize this transcript." });
  }
}

async function fetchPlaylistVideosWithApi(playlistId) {
  const key = process.env.YOUTUBE_API_KEY;
  const videos = [];
  let pageToken = "";

  for (let page = 0; page < 4; page += 1) {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      maxResults: "50",
      playlistId,
      key
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`);
    if (!response.ok) {
      return {
        videos: [],
        source: "manual",
        warning: `YouTube Data API returned HTTP ${response.status}. Check YOUTUBE_API_KEY and playlist access.`
      };
    }

    const data = await response.json();
    for (const item of data.items || []) {
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      const title = item.snippet?.title;
      if (!videoId || !title || title === "Deleted video" || title === "Private video") continue;
      videos.push({
        id: videoId,
        title,
        duration: "",
        url: `https://www.youtube.com/watch?v=${videoId}`
      });
    }

    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }

  if (!videos.length) {
    return {
      videos: [],
      source: "manual",
      warning: "The YouTube Data API did not return public videos for this playlist."
    };
  }

  await enrichVideoDurations(videos, key);
  return { videos, source: "youtube-api", warning: "" };
}

async function enrichVideoDurations(videos, key) {
  const batches = [];
  for (let index = 0; index < videos.length; index += 50) {
    batches.push(videos.slice(index, index + 50));
  }

  for (const batch of batches) {
    const params = new URLSearchParams({
      part: "contentDetails",
      id: batch.map((video) => video.id).join(","),
      key
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    if (!response.ok) continue;

    const data = await response.json();
    const durations = new Map((data.items || []).map((item) => [item.id, item.contentDetails?.duration || ""]));
    batch.forEach((video) => {
      const duration = durations.get(video.id);
      if (duration) video.duration = formatIsoDuration(duration);
    });
  }
}

function normalizeManualTitles(titles = "") {
  return titles
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+[\).:-]?\s*/, "").trim())
    .filter(Boolean)
    .map((title, index) => ({
      id: `manual-${index + 1}`,
      title,
      duration: "",
      url: ""
    }));
}

function pickTheme(titleText) {
  return courseThemes.find((theme) => theme.match.test(titleText)) || {
    track: "Guided Learning Track",
    outcome: "move from fundamentals to independent practice",
    project: "Create a final reference guide and applied capstone from the playlist"
  };
}

function titleCaseFromPlaylist(playlistUrl, videos) {
  const firstTitle = videos[0]?.title || "Playlist";
  const cleaned = firstTitle
    .replace(/\|.*$/, "")
    .replace(/#\d+/g, "")
    .replace(/\b(part|episode|lesson)\s*\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || parsePlaylistId(playlistUrl) || "Playlist";
  return `${base} Course`;
}

function moduleName(index, lessons) {
  const text = lessons.map((lesson) => lesson.title).join(" ");
  const candidates = [
    [/intro|start|beginner|basics|fundamental|overview/i, "Foundations"],
    [/setup|install|environment|tool|workflow/i, "Setup and Workflow"],
    [/project|build|create|implement|app|website/i, "Applied Build"],
    [/advanced|optimize|deploy|scale|production/i, "Advanced Practice"],
    [/review|summary|revision|practice|exercise/i, "Practice and Review"]
  ];
  const matched = candidates.find(([pattern]) => pattern.test(text));
  if (matched) return matched[1];
  return `Module ${index + 1}`;
}

function buildCourse({ playlistUrl, videos, pace = "standard", requestedModules = 0, warning = "", source = "manual" }) {
  const titleText = videos.map((video) => video.title).join(" ");
  const theme = pickTheme(titleText);
  const lessonCount = videos.length;
  const totalMinutes = videos.reduce((sum, video) => sum + parseDurationToMinutes(video.duration), 0);
  const moduleCount = Math.max(1, Math.min(
    lessonCount || 1,
    Number(requestedModules) || Math.ceil((lessonCount || 6) / 5)
  ));
  const chunkSize = Math.ceil((lessonCount || 1) / moduleCount);

  const modules = Array.from({ length: moduleCount }, (_, index) => {
    const lessons = videos.slice(index * chunkSize, index * chunkSize + chunkSize).map((video, lessonIndex) => ({
      number: index * chunkSize + lessonIndex + 1,
      id: video.id,
      title: video.title,
      duration: video.duration || "Self-paced",
      url: video.url,
      embedUrl: video.id?.startsWith("manual-") ? "" : `https://www.youtube.com/embed/${video.id}`,
      focus: createLessonFocus(video.title, index, lessonIndex),
      activity: createActivity(video.title, index, lessonIndex)
    }));

    return {
      number: index + 1,
      title: moduleName(index, lessons),
      goal: createModuleGoal(index, moduleCount, theme),
      checkpoint: createCheckpoint(index, moduleCount, theme),
      lessons
    };
  });

  const weeks = pace === "fast" ? Math.max(1, Math.ceil(moduleCount / 2)) : pace === "deep" ? moduleCount * 2 : moduleCount;

  return {
    title: titleCaseFromPlaylist(playlistUrl, videos),
    source,
    warning,
    summary: {
      lessons: lessonCount,
      modules: moduleCount,
      estimatedHours: Math.max(1, Math.round(totalMinutes / 60)),
      pace,
      weeks
    },
    objective: `By the end, learners should be able to ${theme.outcome} using a structured sequence of lessons, practice tasks, and review checkpoints.`,
    prerequisites: [
      "Basic comfort with the subject area",
      "A notebook or workspace for exercises",
      "Enough uninterrupted time to complete each module checkpoint"
    ],
    modules,
    capstone: {
      title: "Final Capstone",
      brief: theme.project,
      deliverables: [
        "A concise notes pack covering each module",
        "A completed practical artifact or solved problem set",
        "A reflection listing what to revisit and what to learn next"
      ]
    }
  };
}

function createModuleGoal(index, moduleCount, theme) {
  if (index === 0) return `Establish the core vocabulary, tools, and mental models for the ${theme.track.toLowerCase()}.`;
  if (index === moduleCount - 1) return "Consolidate the playlist into an applied result that can be reviewed or shared.";
  return "Connect the previous lessons into usable patterns through guided practice.";
}

function createCheckpoint(index, moduleCount, theme) {
  if (index === moduleCount - 1) return theme.project.endsWith(".") ? theme.project : `${theme.project}.`;
  return "Write a one-page summary and complete one practice task before continuing.";
}

function createLessonFocus(title, moduleIndex, lessonIndex) {
  const lower = title.toLowerCase();
  if (/intro|overview|start/.test(lower)) return "Understand the purpose, vocabulary, and expected outcome.";
  if (/setup|install|environment/.test(lower)) return "Prepare the working environment and confirm everything is ready.";
  if (/project|build|create|implement/.test(lower)) return "Apply the concept in a concrete working example.";
  if (/error|debug|fix|problem/.test(lower)) return "Identify failure cases and learn the troubleshooting path.";
  if (/advanced|optimize|deploy/.test(lower)) return "Move from basic use to stronger real-world execution.";
  return moduleIndex === 0 && lessonIndex === 0
    ? "Capture the key idea and define success criteria for the course."
    : "Extract the core concept, then turn it into a short practice task.";
}

function createActivity(title, moduleIndex, lessonIndex) {
  if (/project|build|create|implement/i.test(title)) return "Pause after the lesson and recreate the main result without looking.";
  if (/setup|install|environment/i.test(title)) return "Document your setup steps and note any issues you had to solve.";
  if (/practice|exercise|problem/i.test(title)) return "Complete the exercise twice: once with guidance and once independently.";
  return lessonIndex % 2 === 0
    ? "Write three bullet notes and one question to answer before the next lesson."
    : "Make a tiny example or explanation that proves you understood the lesson.";
}

async function handleCourseRequest(request, response) {
  try {
    const body = await readRequestJson(request);
    const manualVideos = normalizeManualTitles(body.videoTitles || "");
    let fetched = { videos: [], source: "manual", warning: "" };

    if (body.playlistUrl) {
      try {
        fetched = await fetchPlaylistVideos(body.playlistUrl);
      } catch (error) {
        fetched = {
          videos: [],
          source: "manual",
          warning: `Could not reach YouTube from this server: ${error.message}`
        };
      }
    }

    const videos = fetched.videos.length ? fetched.videos : manualVideos;
    if (!videos.length) {
      sendJson(response, 422, {
        error: "Add a public YouTube playlist link or paste video titles manually."
      });
      return;
    }

    sendJson(response, 200, buildCourse({
      playlistUrl: body.playlistUrl || "",
      videos,
      pace: body.pace,
      requestedModules: body.modules,
      warning: fetched.videos.length ? "" : fetched.warning,
      source: fetched.source
    }));
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Something went wrong." });
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/course") {
    handleCourseRequest(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/video-summary") {
    handleVideoSummaryRequest(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/transcript-summary") {
    handleTranscriptSummaryRequest(request, response);
    return;
  }

  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
}).listen(port, () => {
  console.log(`Playlist to Course is running at http://localhost:${port}`);
});
