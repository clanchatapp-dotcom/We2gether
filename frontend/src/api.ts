import { Platform } from "react-native";

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
  async uploadMedia(uri: string, mediaType: "image" | "video", privacy: string) {
    if (!BASE) throw new Error("Backend URL not set. Rebuild with EXPO_PUBLIC_BACKEND_URL.");
    const form = new FormData();
    // Strip any query/hash and fall back to a safe name with the right extension.
    const clean = uri.split("?")[0].split("#")[0];
    let name = clean.split("/").pop() || "";
    if (!name || !name.includes(".")) name = mediaType === "image" ? "photo.jpg" : "video.mp4";
    const type = mediaType === "image" ? "image/jpeg" : "video/mp4";
    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      form.append("file", blob, name);
    } else {
      form.append("file", { uri, name, type } as any);
    }
    form.append("media_type", mediaType);
    form.append("privacy", privacy);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/messages/media`, {
        method: "POST",
        headers: headers(), // never set Content-Type for multipart
        body: form,
        signal: controller.signal,
      });
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("Upload timed out. Check your connection and try again.");
      throw new Error(`Upload failed to reach the server (${e?.message || "network error"}).`);
    } finally {
      clearTimeout(timer);
    }
    return handle(res);
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
