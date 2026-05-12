import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Feed } from "./pages/Feed";
import { ExperimentDetail } from "./pages/ExperimentDetail";
import { GroupListing } from "./pages/GroupListing";
import { Trash } from "./pages/Trash";
import { CatalogPage } from "./pages/Catalog";
import { ComponentPage } from "./pages/ComponentDetail";
import { DocPage } from "./pages/Documents";
import { SimulationPage } from "./pages/Simulation";
import { LaminaeLayout } from "./pages/LaminaeLayout";
import "./components/laminae";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Strata experiment pages */}
        <Route path="/" element={<Feed />} />
        <Route path="/e/:slug" element={<ExperimentDetail />} />
        <Route path="/g/:group" element={<GroupListing />} />
        <Route path="/trash" element={<Trash />} />
        {/* Laminae pages */}
        <Route path="/catalog" element={<LaminaeLayout><CatalogPage /></LaminaeLayout>} />
        <Route path="/component/:id" element={<LaminaeLayout><ComponentPage /></LaminaeLayout>} />
        <Route path="/doc" element={<LaminaeLayout><DocPage /></LaminaeLayout>} />
        <Route path="/doc/:slug" element={<LaminaeLayout><DocPage /></LaminaeLayout>} />
        <Route path="/simulation/cusp" element={<LaminaeLayout><SimulationPage /></LaminaeLayout>} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
