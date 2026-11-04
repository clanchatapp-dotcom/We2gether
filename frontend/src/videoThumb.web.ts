// Web: draw a frame of the video onto a canvas and return it as a JPEG data URL.
export function makeVideoThumb(uri: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      video.removeAttribute("src");
      video.load();
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      try {
        const scale = Math.min(1, 480 / (video.videoWidth || 480));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round((video.videoWidth || 480) * scale);
        canvas.height = Math.round((video.videoHeight || 640) * scale);
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        clearTimeout(timer);
        finish(canvas.toDataURL("image/jpeg", 0.75));
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    };
    video.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    video.src = uri;
  });
}
