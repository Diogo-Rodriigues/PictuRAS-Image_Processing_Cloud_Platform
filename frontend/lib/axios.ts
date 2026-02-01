import axios from "axios";

export const api = axios.create({
  baseURL: "http://localhost:8080/api-gateway/",
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.data) {
      if (typeof error.response.data === "string") {
        error.message = error.response.data;
      } else if (error.response.data.message) {
        error.message = error.response.data.message;
      } else if (error.response.data.error) {
        error.message = error.response.data.error;
      }
    }
    return Promise.reject(error);
  },
);