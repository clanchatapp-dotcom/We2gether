import { Platform } from "react-native";
import { File, UploadType } from "expo-file-system";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

let currentUserId: string | null = null;

export function setAuthUserId(id: string | null) {
  currentUserId = id;
}

function headers(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { ...extra };
  if (currentUserId) h["X-User-Id"] = currentUserId;
  return h;
}

async function handle(res: Response) {
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* plain text / empty body */
    }
    const err: any = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function guessMime(name: string, mediaType: "image" | "video"): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heic",
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
  };
  if (ext && map[ext]) return map[ext];
  return mediaType === "image" ? "image/jpeg" : "video/mp4";
}

export const api = {
  async get(path: string) {
    const res = await fetch(`${BASE}/api${path}`, { headers: headers() });
    return handle(res);
  },
  async post(path: string, body?: any) {
    const res = await fetch(`${BASE}/api${path}`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: body ? JSON.stringify(body) : undefined,
    });
    return handle(res);
  },
  async del(path: string) {
    const res = await fetch(`${BASE}/api${path}`, {
      method: "DELETE",
      headers: headers(),
    });
    return handle(res);
  },
  async uploadMedia(
    uri: string,
    mediaType: "image" | "video",
    privacy: string,
    opts?: { fileName?: string; mimeType?: string },
  ) {
    if (!BASE) throw new Error("Missing backend URL");
    const fallback = mediaType === "image" ? "photo.jpg" : "video.mp4";
    const name = opts?.fileName || uri.split("/").pop() || fallback;

    if (Platform.OS === "web") {
      const form = new FormData();
      const blob = await (await fetch(uri)).blob();
      form.append("file", blob, name);
      form.append("media_type", mediaType);
      form.append("privacy", privacy);
      const res = await fetch(`${BASE}/api/messages/media`, {
        method: "POST",
        headers: headers(), // never set Content-Type for multipart
        body: form,
      });
      return handle(res);
    }

    // Native: stream the file straight off disk as a multipart upload.
    // The previous Blob + global-fetch path silently failed for videos and
    // animated GIFs (large/binary bodies) while small JPEGs happened to slip
    // through. expo-file-system's upload reads from the file uri natively, so
    // it handles photos, GIFs and long videos identically and reliably.
    const file = new File(uri);
    const mimeType = opts?.mimeType || guessMime(name, mediaType);
    const result = await file.upload(`${BASE}/api/messages/media`, {
      httpMethod: "POST",
      uploadType: UploadType.MULTIPART,
      fieldName: "file",
      mimeType,
      headers: headers(),
      parameters: { media_type: mediaType, privacy },
    });
    if (result.status < 200 || result.status >= 300) {
      let detail = `Upload failed (${result.status})`;
      try {
        const b = JSON.parse(result.body);
        detail = b.detail || detail;
      } catch {
        /* non-JSON body */
      }
      const err: any = new Error(detail);
      err.status = result.status;
      throw err;
    }
    try {
      return JSON.parse(result.body);
    } catch {
      return {};
    }
  },
};

// Build an expo-image source for a protected media path.
export function mediaSource(path: string) {
  if (Platform.OS === "web") {
    return { uri: `${BASE}/api/files/${path}?uid=${currentUserId}` };
  }
  return {
    uri: `${BASE}/api/files/${path}`,
    headers: currentUserId ? { "X-User-Id": currentUserId } : undefined,
  };
}

export function mediaVideoUri(path: string) {
  if (Platform.OS === "web") {
    return `${BASE}/api/files/${path}?uid=${currentUserId}`;
  }
  return `${BASE}/api/files/${path}`;
}

// Lightweight reachability check for the backend. Render free instances sleep
// after inactivity and can take up to ~50s to wake, so the caller uses a long
// timeout and retries. Returns true only on a 2xx from GET /api/.
export async function pingBackend(timeoutMs = 25000): Promise<boolean> {
  if (!BASE) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/`, { method: "GET", signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
