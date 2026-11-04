import * as VideoThumbnails from "expo-video-thumbnails";

// Grabs a JPEG frame from a local or remote video; null if it fails.
export async function makeVideoThumb(
  uri: string,
  headers?: Record<string, string>,
): Promise<string | null> {
  try {
    const { uri: thumb } = await VideoThumbnails.getThumbnailAsync(uri, {
      time: 500,
      quality: 0.7,
      headers,
    });
    return thumb;
  } catch {
    return null;
  }
}
