import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { initAppLogging } from "@/lib/logger";
import "./index.css";

initAppLogging();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
