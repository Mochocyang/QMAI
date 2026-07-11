import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "@/i18n";
import { ToastProvider } from "@/lib/toast";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
