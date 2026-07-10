// SPDX-License-Identifier: AGPL-3.0-only
// Browser preview harness for the page-detail citations redesign and the
// review-queue redesign (DistillReviewPanel + ReviewDialog).
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PageDetail from "../src/components/memory/PageDetail";
import DistillReviewPanel from "../src/components/memory/DistillReviewPanel";
import { initializeI18n } from "../src/i18n";
import { resetReviewFixtures } from "./fixtures";
import "../src/index.css";

const VARIANTS = [
  { id: "page-cited", label: "Cited (all kinds)" },
  { id: "page-cleared", label: "Edit-cleared" },
  { id: "page-mismatch", label: "Mismatch" },
  { id: "page-plain", label: "No citations" },
];

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
});

function Harness() {
  const [mode, setMode] = useState<"page" | "review">("review");
  const [pageId, setPageId] = useState("page-cited");
  const [theme, setTheme] = useState("dark");
  const [reviewRun, setReviewRun] = useState(0);

  const applyTheme = (next: string) => {
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
  };

  const tab = (active: boolean) => ({
    padding: "3px 10px",
    borderRadius: 6,
    border: "1px solid var(--mem-border)",
    background: active ? "var(--mem-accent, #6366f1)" : "transparent",
    color: active ? "#fff" : "inherit",
    cursor: "pointer",
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--mem-bg)" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "10px 16px",
          borderBottom: "1px solid var(--mem-border)",
          alignItems: "center",
          fontFamily: "var(--mem-font-mono)",
          fontSize: 12,
          color: "var(--mem-text-secondary)",
        }}
      >
        <span style={{ fontWeight: 600 }}>PREVIEW</span>
        <button onClick={() => setMode("review")} style={tab(mode === "review")}>
          Review queue
        </button>
        <button onClick={() => setMode("page")} style={tab(mode === "page")}>
          Page detail
        </button>
        <span style={{ opacity: 0.4 }}>|</span>
        {mode === "page" ? (
          VARIANTS.map((v) => (
            <button key={v.id} onClick={() => setPageId(v.id)} style={tab(pageId === v.id)}>
              {v.label}
            </button>
          ))
        ) : (
          <button
            onClick={() => {
              resetReviewFixtures();
              client.clear();
              setReviewRun((n) => n + 1);
            }}
            style={tab(false)}
          >
            Reset queue
          </button>
        )}
        <button
          onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}
          style={{ ...tab(false), marginLeft: "auto" }}
        >
          {theme === "dark" ? "☀ light" : "☾ dark"}
        </button>
      </div>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>
        {mode === "page" ? (
          <PageDetail
            key={pageId}
            pageId={pageId}
            onBack={() => console.log("[preview] onBack")}
            onMemoryClick={(id: string) => console.log("[preview] onMemoryClick:", id)}
            onPageClick={(id: string) => {
              console.log("[preview] onPageClick:", id);
              setPageId(id);
            }}
          />
        ) : (
          <DistillReviewPanel
            key={reviewRun}
            onBack={() => console.log("[preview] onBack")}
            onPageClick={(id: string) => {
              console.log("[preview] onPageClick:", id);
              setMode("page");
              setPageId(id);
            }}
            onMemoryClick={(id: string) => console.log("[preview] onMemoryClick:", id)}
          />
        )}
      </div>
    </div>
  );
}

void initializeI18n().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    </StrictMode>,
  );
});
