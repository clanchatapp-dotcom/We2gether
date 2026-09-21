import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const apiClient = axios.create({ baseURL: API });

// ---- Spaces ----
export const createSpace = async () => (await apiClient.post("/spaces")).data;
export const getSpace = async (code) => (await apiClient.get(`/spaces/${code}`)).data;

// ---- Events ----
export const listEvents = async (code) => (await apiClient.get("/events", { params: { code } })).data;
export const createEvent = async (payload) => (await apiClient.post("/events", payload)).data;
export const deleteEvent = async (id) => (await apiClient.delete(`/events/${id}`)).data;

// ---- Messages ----
export const listMessages = async (code) => (await apiClient.get("/messages", { params: { code } })).data;
export const createMessage = async (payload) => (await apiClient.post("/messages", payload)).data;

// ---- Gallery ----
export const listGallery = async (code) => (await apiClient.get("/gallery", { params: { code } })).data;
export const uploadPhoto = async ({ code, caption, file }) => {
  const form = new FormData();
  form.append("code", code);
  form.append("caption", caption || "");
  form.append("file", file);
  return (await apiClient.post("/gallery/upload", form)).data;
};
export const deletePhoto = async (id) => (await apiClient.delete(`/gallery/${id}`)).data;
export const photoUrl = (id) => `${API}/gallery/file/${id}`;
