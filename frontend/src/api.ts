import { Platform } from "react-native";
import { File } from "expo-file-system";

/*
 * Backend URL
 *
 * GitHub Actions should provide EXPO_PUBLIC_BACKEND_URL as a secret.
 *
 * The fallback is the live 2gether backend so the APK cannot fall back
 * to the old calendar test server.
 */
const CONFIGURED_BASE =
  process.env.EXPO_PUBLIC_BACKEND_URL?.trim() ||
  "https://couples-space-api.emergent.host";

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
  ) {
    const form = new FormData();

    const name =
      uri.split("/").pop() ||
      (mediaType === "image" ? "photo.jpg" : "video.mp4");

    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();

      form.append("file", blob, name);
    } else {
      /*
       * Expo SDK 57:
       *
       * expo-file-system's File implements the Blob interface,
       * which is required for FormData uploads.
       */
      const fileObj = new File(uri);

      form.append("file", fileObj, name);
    }

    form.append("media_type", mediaType);
    form.append("privacy", privacy);

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
    uri: `${BASE}/api/files/${path}`,
    headers: currentUserId
      ? {
          "X-User-Id": currentUserId,
        }
      : undefined,
  };
}

export function mediaVideoUri(path: string) {
  if (Platform.OS === "web") {
    return `${BASE}/api/files/${path}?uid=${currentUserId}`;
  }

  return `${BASE}/api/files/${path}`;
}

/*
 * Useful for diagnosing API configuration from the app.
 */
export function getBackendUrl() {
  return BASE;
}
