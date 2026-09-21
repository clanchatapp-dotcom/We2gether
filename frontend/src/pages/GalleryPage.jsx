import React, { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Images, Loader2, Trash2, X, Download } from "lucide-react";
import { toast } from "sonner";
import { listGallery, uploadPhoto, deletePhoto, photoUrl } from "@/lib/api";
import { useSpace } from "@/context/SpaceContext";
import { formatDateTime } from "@/lib/time";
import { Button } from "@/components/ui/button";

export default function GalleryPage() {
  const { code } = useSpace();
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [lightbox, setLightbox] = useState(null);
  const [dragging, setDragging] = useState(false);

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ["gallery", code],
    queryFn: () => listGallery(code),
  });

  const uploadMut = useMutation({
    mutationFn: uploadPhoto,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery", code] });
      toast.success("Photo uploaded \u2764");
    },
    onError: () => toast.error("Upload failed. Try a JPEG/PNG/WebP image."),
  });

  const deleteMut = useMutation({
    mutationFn: deletePhoto,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery", code] });
      toast.success("Photo removed");
      setLightbox(null);
    },
  });

  const handleFiles = (files) => {
    const list = Array.from(files || []);
    list.forEach((file) => {
      if (!file.type.startsWith("image/")) return toast.error("Only image files are allowed");
      uploadMut.mutate({ code, caption: "", file });
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-espresso">Gallery</h1>
          <p className="text-espresso/60 text-sm mt-1">Your moments, together in one place.</p>
        </div>
        <Button
          data-testid="gallery-upload-button"
          onClick={() => fileRef.current?.click()}
          disabled={uploadMut.isPending}
          className="h-11 rounded-xl bg-terra hover:bg-terra-dark text-white font-semibold"
        >
          {uploadMut.isPending ? <Loader2 className="h-5 w-5 mr-1 animate-spin" /> : <Upload className="h-5 w-5 mr-1" />}
          Upload photo
        </Button>
        <input
          ref={fileRef}
          data-testid="gallery-upload-input"
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-terra bg-terra/5" : "border-oatline bg-white"
        }`}
      >
        <Upload className="h-8 w-8 text-terra/50 mx-auto mb-2" />
        <p className="text-espresso/60 text-sm">Drag & drop photos here, or click to browse</p>
      </div>

      {isLoading ? (
        <div className="h-60 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-terra" />
        </div>
      ) : photos.length === 0 ? (
        <div className="h-60 flex flex-col items-center justify-center text-center text-espresso/50 gap-2 bg-white rounded-2xl border border-oatline">
          <Images className="h-10 w-10 text-terra/40" />
          <p>No photos yet. Upload your first memory together.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map((p) => (
            <div
              key={p.id}
              data-testid="gallery-photo-item"
              onClick={() => setLightbox(p)}
              className="group relative aspect-square rounded-2xl overflow-hidden border border-oatline bg-oat cursor-pointer"
            >
              <img
                src={photoUrl(p.id)}
                alt={p.caption || p.original_filename}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-espresso/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          data-testid="gallery-lightbox"
          className="fixed inset-0 z-50 bg-espresso/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
            onClick={() => setLightbox(null)}
          >
            <X className="h-7 w-7" />
          </button>
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={photoUrl(lightbox.id)}
              alt={lightbox.caption}
              className="w-full max-h-[75vh] object-contain rounded-2xl"
            />
            <div className="flex items-center justify-between mt-4">
              <p className="text-white/70 text-sm">{formatDateTime(lightbox.created_at)}</p>
              <div className="flex gap-2">
                <a
                  href={photoUrl(lightbox.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20"
                >
                  <Download className="h-5 w-5" />
                </a>
                <button
                  data-testid="gallery-photo-delete-button"
                  onClick={() => deleteMut.mutate(lightbox.id)}
                  className="p-2 rounded-lg bg-terra text-white hover:bg-terra-dark"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
