"use client";

/**
 * Client-side coordinator for the Upload -> Verify -> Analyze -> Document
 * workflow. This component only orchestrates UI state and calls the API
 * routes; all detection/scoring/retrieval/LLM logic lives server-side in
 * `src/lib/threatlens/*`.
 */
import { useState } from "react";
import type { AnalysisResult, EvidenceRecord, OcrResult, ThreatSignal } from "@/lib/threatlens/schemas/models";

interface UploadResponse {
  evidence: EvidenceRecord;
  ocr: OcrResult;
}

const SEVERITY_STYLES: Record<string, string> = {
  LOW: "bg-emerald-100 text-emerald-800 border-emerald-300",
  MEDIUM: "bg-amber-100 text-amber-800 border-amber-300",
  HIGH: "bg-orange-100 text-orange-800 border-orange-300",
  CRITICAL: "bg-red-100 text-red-800 border-red-300",
  INSUFFICIENT_INFORMATION: "bg-slate-100 text-slate-700 border-slate-300",
};

export default function ThreatLensApp() {
  const [evidence, setEvidence] = useState<EvidenceRecord | null>(null);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [verifiedText, setVerifiedText] = useState<string>("");
  const [verifiedSaved, setVerifiedSaved] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  const [uploading, setUploading] = useState(false);
  const [savingVerification, setSavingVerification] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setError(null);
    setUploading(true);
    setEvidence(null);
    setOcr(null);
    setVerifiedText("");
    setVerifiedSaved(false);
    setAnalysis(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/evidence", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      const payload = data as UploadResponse;
      setEvidence(payload.evidence);
      setOcr(payload.ocr);
      setVerifiedText(payload.ocr.rawText ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveVerification() {
    if (!evidence) return;
    setError(null);
    setSavingVerification(true);
    try {
      const res = await fetch(`/api/evidence/${evidence.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifiedText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save verified text.");
      setVerifiedSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save verified text.");
    } finally {
      setSavingVerification(false);
    }
  }

  async function handleAnalyze() {
    if (!evidence) return;
    setError(null);
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/evidence/${evidence.id}/analyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed.");
      setAnalysis(data.analysis as AnalysisResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  function handleDownloadReport() {
    if (!evidence) return;
    window.open(`/api/evidence/${evidence.id}/report`, "_blank");
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">ThreatLens</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">Digital Abuse Evidence Intake &amp; Analysis</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Upload a screenshot, verify the extracted text, run deterministic analysis, and generate a documentation
          report. This tool provides decision support, not legal or clinical conclusions -- every automated finding
          below is clearly labeled by its source.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <StepCard step={1} title="Upload evidence">
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.bmp"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
          }}
          className="block w-full rounded-md border border-slate-300 p-2 text-sm file:mr-4 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-white"
        />
        {uploading && <p className="mt-2 text-sm text-slate-500">Uploading and running OCR…</p>}

        {evidence && (
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 rounded-md bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <Field label="Evidence ID" value={evidence.id} mono />
            <Field label="Original filename" value={evidence.originalFilename} />
            <Field label="Declared type" value={evidence.declaredMimeType} />
            <Field label="Detected type (magic bytes)" value={evidence.detectedMimeType ?? "unknown"} />
            <Field label="Size" value={`${evidence.sizeBytes.toLocaleString()} bytes`} />
            <Field label="Uploaded at" value={new Date(evidence.uploadedAt).toLocaleString()} />
            <Field label="SHA-256 (integrity, not authenticity)" value={evidence.sha256} mono full />
          </dl>
        )}
      </StepCard>

      {evidence && ocr && (
        <StepCard step={2} title="Verify extracted text">
          <OcrSummary ocr={ocr} />
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Raw OCR text is shown below. Correct any errors before analysis -- OCR output is not ground truth.
          </label>
          <textarea
            value={verifiedText}
            onChange={(e) => {
              setVerifiedText(e.target.value);
              setVerifiedSaved(false);
            }}
            rows={8}
            className="mt-2 w-full rounded-md border border-slate-300 p-3 font-mono text-sm"
            placeholder="Enter or correct the message text here…"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => void handleSaveVerification()}
              disabled={savingVerification || verifiedText.trim().length === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {savingVerification ? "Saving…" : "Save verified text"}
            </button>
            {verifiedSaved && <span className="text-sm text-emerald-700">Saved ✓</span>}
          </div>
        </StepCard>
      )}

      {evidence && verifiedSaved && (
        <StepCard step={3} title="Analyze">
          <button
            onClick={() => void handleAnalyze()}
            disabled={analyzing}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {analyzing ? "Analyzing…" : "Run analysis"}
          </button>

          {analysis && <AnalysisView analysis={analysis} />}
        </StepCard>
      )}

      {evidence && analysis && (
        <StepCard step={4} title="Document">
          <p className="text-sm text-slate-600">
            Generate a Markdown report combining evidence metadata, OCR output, verified text, detected signals,
            risk assessment, retrieved references, and the AI explanation. It is a working document, not an
            official legal filing.
          </p>
          <button
            onClick={handleDownloadReport}
            className="mt-3 rounded-md border border-slate-900 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
          >
            Download report (.md)
          </button>
        </StepCard>
      )}
    </div>
  );
}

function StepCard({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs text-white">
          {step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value, mono, full }: { label: string; value: string; mono?: boolean; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`break-all text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function OcrSummary({ ocr }: { ocr: OcrResult }) {
  if (!ocr.succeeded) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        OCR did not succeed: {ocr.errorMessage ?? "unknown error"}. You can still enter the text manually below.
      </div>
    );
  }
  return (
    <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
      <p>
        Confidence: <strong>{ocr.confidence !== null ? `${ocr.confidence.toFixed(1)}%` : "n/a"}</strong> · Language:{" "}
        {ocr.language}
      </p>
      {ocr.warnings.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-amber-800">
          {ocr.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnalysisView({ analysis }: { analysis: AnalysisResult }) {
  const severityClass = SEVERITY_STYLES[analysis.risk.severity] ?? SEVERITY_STYLES.INSUFFICIENT_INFORMATION;
  return (
    <div className="mt-5 space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Risk assessment</h3>
        <div className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${severityClass}`}>
          {analysis.risk.severity}
          {analysis.risk.score !== null && <span className="font-normal">score {analysis.risk.score}/10</span>}
        </div>
        <p className="mt-2 text-sm text-slate-700">{analysis.risk.explanation}</p>
        <p className="mt-1 text-xs text-slate-500">
          Uncertainty: <strong>{analysis.risk.uncertainty.level}</strong>
          {analysis.risk.uncertainty.reasons.length > 0 ? ` — ${analysis.risk.uncertainty.reasons.join(" ")}` : ""}
        </p>
        {analysis.risk.contributingFactors.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-sm text-slate-700">
            {analysis.risk.contributingFactors.map((f) => (
              <li key={f.category}>{f.description}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Detected signals ({analysis.signals.length})
        </h3>
        {analysis.signals.length === 0 ? (
          <p className="text-sm text-slate-600">No rule-based signals were detected in the verified text.</p>
        ) : (
          <ul className="space-y-2">
            {analysis.signals.map((s, i) => (
              <SignalItem key={i} signal={s} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Retrieved reference material ({analysis.references.length})
        </h3>
        {analysis.references.length === 0 ? (
          <p className="text-sm text-slate-600">No reference material met the similarity threshold.</p>
        ) : (
          <ul className="space-y-2">
            {analysis.references.map((r) => (
              <li key={`${r.documentId}-${r.title}`} className="rounded-md border border-slate-200 p-3 text-sm">
                <p className="font-medium text-slate-900">
                  {r.title} <span className="font-normal text-slate-500">(similarity {r.similarity})</span>
                </p>
                <p className="mt-1 text-slate-600">{r.snippet}</p>
                <p className="mt-1 text-xs text-slate-400">Source: {r.source}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">AI-generated explanation</h3>
        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">
          <p>{analysis.llm.summary}</p>
          <p className="mt-2 text-xs text-indigo-700">
            {analysis.llm.available
              ? `Generated by ${analysis.llm.model ?? "LLM"}.`
              : "LLM unavailable -- showing deterministic fallback summary."}
          </p>
        </div>
      </div>
    </div>
  );
}

function SignalItem({ signal }: { signal: ThreatSignal }) {
  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold uppercase text-white">
          {signal.category.replace(/_/g, " ")}
        </span>
        <span className="text-xs text-slate-500">confidence {signal.confidence.toFixed(2)}</span>
        <span className="text-xs text-slate-400">source: {signal.detectionSource.replace(/_/g, " ")}</span>
      </div>
      <p className="mt-2 italic text-slate-700">&ldquo;{signal.evidenceSpan}&rdquo;</p>
      <p className="mt-1 text-slate-600">{signal.explanation}</p>
    </li>
  );
}
