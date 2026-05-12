import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Feed } from "./pages/Feed";
import { ExperimentDetail } from "./pages/ExperimentDetail";
import { GroupListing } from "./pages/GroupListing";
import { Trash } from "./pages/Trash";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/e/:slug" element={<ExperimentDetail />} />
        <Route path="/g/:group" element={<GroupListing />} />
        <Route path="/trash" element={<Trash />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
