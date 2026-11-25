import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import {SharedCommercialCalendar} from "./CommercialCalendar.jsx";
import "./styles.css";
import "./brand.css";
import "./modules.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>{window.location.pathname.replace(/\/$/, "")==="/calendario-compartido"?<SharedCommercialCalendar/>:<App />}</StrictMode>
);
