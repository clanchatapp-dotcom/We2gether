import { Platform } from "react-native";
import { File } from "expo-file-system";

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
    const form = new FormData();
    const name = uri.split("/").pop() || (mediaType === "image" ? "photo.jpg" : "video.mp4");
    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      form.append("file", blob, name);
    } else {
      // Expo SDK 57's global fetch (expo/fetch) only accepts a string, a Blob,
      // or an object exposing bytes() as a FormData part — it no longer reads
      // React Native's legacy { uri, name, type } shape (throws "Unsupported
      // FormDataPart implementation" before the request ever leaves the device).
      // expo-file-system's File implements the Blob interface, so it works here.
      const fileObj = new File(uri);
      form.append("file", fileObj, name);
    }
    form.append("media_type", mediaType);
    form.append("privacy", privacy);
    const res = await fetch(`${BASE}/api/messages/media`, {
      method: "POST",
      headers: headers(), // never set Content-Type for multipart
      body: form,
    });
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
