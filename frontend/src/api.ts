import { Platform } from "react-native";

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
  const h: Record<string, string> = { ...extra };
  if (currentUserId) h["X-User-Id"] = currentUserId;
  return h;
}

async function handle(res: Response) {
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      try {
        const text = await res.text();
        if (text?.trim()) detail = text.trim();
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

async function request(url: string, options: RequestInit = {}) {
  if (!BASE) {
    throw new Error(
      "Backend URL is missing. Set EXPO_PUBLIC_BACKEND_URL in the build environment.",
    );
  }

  try {
    return await fetch(url, options);
  } catch (error: any) {
    const message = error?.message || "Could not connect to the 2gether backend.";
    const err: any = new Error(`Backend connection failed: ${message}`);
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
) {
  const normalize = (value?: string | null) => {
    if (!value) return "";
    const cleaned = value.toLowerCase().replace(/^\./, "").replace("quicktime", "mov");
    return cleaned.split(/[?#]/)[0].trim();
  };

  const allowed = new Set([
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "heic",
    "mp4",
    "m4v",
    "mov",
  ]);

  const lastNameSegment = fileName || uri.split(/[\\/]/).pop() || "";
  const fromName = normalize(lastNameSegment.match(/\.([^.]+)$/)?.[1]);
  const fromMime = normalize((mimeType || "").split("/")[1]);
  const fromUri = normalize((uri.split(/[\\/]/).pop() || "").match(/\.([^.]+)$/)?.[1]);
  const ext = [fromName, fromMime, fromUri].find(value => !!value && allowed.has(value));
  return `upload.${ext || (mediaType === "video" ? "mp4" : "jpg")}`;
}

export const api = {
  async get(path: string) {
    const url = buildUrl(path);
    const res = await request(url, { method: "GET", headers: headers() });
    return handle(res);
  },

  async post(path: string, body?: any) {
    const url = buildUrl(path);
    const res = await request(url, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handle(res);
  },

  async del(path: string) {
    const url = buildUrl(path);
    const res = await request(url, { method: "DELETE", headers: headers() });
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
    const name = uploadFileName(uri, mediaType, fileName, mimeType);
    const url = buildUrl("/messages/media");

    // Builds the multipart body. On phones a file part is normally the
    // classic {uri, name, type} object. Some fetch implementations reject
    // that ("Unsupported FormDataPart implementation"), so there is a second
    // mode that uses expo-file-system's File object instead.
    const buildForm = async (useFileClass: boolean) => {
      const form = new FormData();

      if (Platform.OS === "web") {
        const blob = await (await fetch(uri)).blob();
        const finalName = uploadFileName(uri, mediaType, fileName, mimeType || blob.type);
        form.append("file", blob, finalName);
        if (thumbUri) {
          form.append("thumbnail", await (await fetch(thumbUri)).blob(), "thumb.jpg");
        }
      } else {
        const part = (partUri: string, partName: string, partType: string): any => {
          if (useFileClass) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const FS = require("expo-file-system");
            return new FS.File(partUri);
          }
          return { uri: partUri, name: partName, type: partType };
        };
        form.append(
          "file",
          part(uri, name, mimeType || (mediaType === "video" ? "video/mp4" : "image/jpeg")),
        );
        if (thumbUri) form.append("thumbnail", part(thumbUri, "thumb.jpg", "image/jpeg"));
      }

      form.append("media_type", mediaType);
      form.append("privacy", privacy);
      form.append("spoiler", spoiler ? "true" : "false");
      return form;
    };

    let res: Response;
    try {
      res = await request(url, { method: "POST", headers: headers(), body: await buildForm(false) });
    } catch (error: any) {
      if (Platform.OS === "web" || !String(error?.message || "").includes("FormDataPart")) {
        throw error;
      }
      res = await request(url, { method: "POST", headers: headers(), body: await buildForm(true) });
    }

    return handle(res);
  },
};

export function mediaSource(path: string) {
  if (Platform.OS === "web") {
    return {
      uri: `${BASE}/api/files/${path}?uid=${currentUserId}`,
    };
  }

  return {
    uri: `${BASE}/api/files/${path}?uid=${currentUserId}`,
    headers: currentUserId ? { "X-User-Id": currentUserId } : undefined,
  };
}

export function mediaVideoUri(path: string) {
  const uri = `${BASE}/api/files/${path}?uid=${currentUserId}`;
  if (Platform.OS === "web") return uri;
  return {
    uri,
    headers: currentUserId ? { "X-User-Id": currentUserId } : undefined,
  };
}

export function getBackendUrl() {
  return BASE;
}
