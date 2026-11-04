import { Platform } from "react-native";
import { File } from "expo-file-system";

/*
 * Backend URL
 *
 * GitHub Actions should provide EXPO_PUBLIC_BACKEND_URL as a secret.
 *
 * The fallback is the live Render backend.
 */
const CONFIGURED_BASE =
  process.env.EXPO_PUBLIC_BACKEND_URL?.trim() ||
  "https://we2gether.onrender.com";

const BASE = CONFIGURED_BASE.replace(/\/+$/, "");

let currentUserId: string | null = null;

export function setAuthUserId(id: string | null) {
  currentUserId = id;
}

function headers(extra: Record<string, string> = {}) {
  const h: Record<string, string> = {
    ...extra,
  };

  if (currentUserId) {
    h["X-User-Id"] = currentUserId;
  }

  return h;
}

async function handle(res: Response) {
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;

    try {
      const body = await res.json();

      if (body?.detail) {
        detail = body.detail;
      }
    } catch {
      try {
        const text = await res.text();

        if (text?.trim()) {
          detail = text.trim();
        }
      } catch {
        // Ignore response parsing failures.
      }
    }

    const err: any = new Error(detail);
    err.status = res.status;
    err.url = res.url;

    throw err;
  }

  return res.json();
}

function buildUrl(path: string) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}/api${cleanPath}`;
}

async function request(
  url: string,
  options: RequestInit = {},
) {
  if (!BASE) {
    throw new Error(
      "Backend URL is missing. Set EXPO_PUBLIC_BACKEND_URL in the build environment.",
    );
  }

  try {
    return await fetch(url, options);
  } catch (error: any) {
    const message =
      error?.message ||
      "Could not connect to the 2gether backend.";

    const err: any = new Error(
      `Backend connection failed: ${message}`,
    );

    err.cause = error;
    err.url = url;

    throw err;
  }
}

function uploadFileName(
  uri: string,
  mediaType: "image" | "video",
  fileName?: string | null,
  mimeType?: string | null,
  blobType?: string,
) {
  const allowedExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "mp4", "m4v", "mov"]);
  const normalizeExtension = (value?: string | null) => {
    const ext = value?.toLowerCase().replace(/^\./, "").replace("quicktime", "mov");
    return ext === "jpeg" ? "jpg" : ext;
  };
  const name = fileName?.split(/[\\/]/).pop() || "";
  const namedExtension = normalizeExtension(name.match(/\.([^.]+)$/)?.[1]);
  const uriPath = decodeURIComponent(uri.split(/[?#]/)[0]);
  const uriName = uriPath.split(/[\\/]/).pop() || "";
  const uriExtension = normalizeExtension(uriName.match(/\.([^.]+)$/)?.[1]);
  const mimeExtension = normalizeExtension((mimeType || blobType)?.split("/")[1]);
  const extension = [namedExtension, mimeExtension, uriExtension].find(ext => ext && allowedExtensions.has(ext));
  return `upload.${extension || (mediaType === "video" ? "mp4" : "jpg")}`;
}

export const api = {
  async get(path: string) {
    const url = buildUrl(path);

    const res = await request(url, {
      method: "GET",
      headers: headers(),
    });

    return handle(res);
  },

  async post(path: string, body?: any) {
    const url = buildUrl(path);

    const res = await request(url, {
      method: "POST",
      headers: headers({
        "Content-Type": "application/json",
      }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    return handle(res);
  },

  async del(path: string) {
    const url = buildUrl(path);

    const res = await request(url, {
      method: "DELETE",
      headers: headers(),
    });

    return handle(res);
  },

  async uploadMedia(
    uri: string,
    mediaType: "image" | "video",
    privacy: string,
    spoiler = false,
    thumbUri: string | null = null,
    fileName?: string | null,
    mimeType?: string | null,
  ) {
    const form = new FormData();
    const name = uploadFileName(uri, mediaType, fileName, mimeType);

    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      const finalName = uploadFileName(uri, mediaType, fileName, mimeType, blob.type);
      form.append("file", blob, finalName);
    } else {
      // Keep the selected asset's real extension (not the cache URI's opaque
      // name) so the server stores and serves videos with the right media type.
      const fileObj = new File(uri);
      form.append("file", fileObj, name);
    }

    if (thumbUri) {
      if (Platform.OS === "web") {
        form.append("thumbnail", await (await fetch(thumbUri)).blob(), "thumb.jpg");
      } else {
        const thumbnail = new File(thumbUri);
        form.append("thumbnail", thumbnail, "thumb.jpg");
      }
    }

    form.append("media_type", mediaType);
    form.append("privacy", privacy);
    form.append("spoiler", spoiler ? "true" : "false");

    const url = buildUrl("/messages/media");

    const res = await request(url, {
      method: "POST",
      headers: headers(),
      body: form,
    });

    return handle(res);
  },
};

// Build an expo-image source for protected media.
export function mediaSource(path: string) {
  if (Platform.OS === "web") {
    return {
      uri: `${BASE}/api/files/${path}?uid=${currentUserId}`,
    };
  }

  return {
    uri: `${BASE}/api/files/${path}?uid=${currentUserId}`,
    headers: currentUserId
      ? {
          "X-User-Id": currentUserId,
        }
      : undefined,
  };
}

// expo-video needs an explicit source object on native so the authenticated
// request includes the same user header used by images and API calls. Native
// video playback cannot rely on the app's fetch wrapper to add this header.
// The uid query param is also added on native as a fallback for players
// that drop custom headers on range requests.
export function mediaVideoUri(path: string) {
  const uri = `${BASE}/api/files/${path}?uid=${currentUserId}`;

  if (Platform.OS === "web") {
    return uri;
  }

  return {
    uri,
    headers: currentUserId
      ? {
          "X-User-Id": currentUserId,
        }
      : undefined,
  };
}

/*
 * Useful for diagnosing API configuration from the app.
 */
export function getBackendUrl() {
  return BASE;
}
