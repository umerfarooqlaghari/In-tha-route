"use client";

import { motion } from "motion/react";
import { Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchFile, type Portal } from "@/lib/api";

/**
 * A private file (receipt photo or driver document) fetched with the admin's
 * sign-in. Photos and PDFs show inline; a .docx can be downloaded.
 * Give it a `key` per file so a new file starts from the loading state.
 */
export function FileViewer({
  path,
  kind = "image",
  name,
  portal = "admin",
}: {
  path: string;
  kind?: "image" | "pdf" | "word";
  name: string;
  portal?: Portal;
}) {
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetchFile(portal, path)
      .then((f) => {
        url = f.url;
        if (cancelled) URL.revokeObjectURL(f.url);
        else setFile(f);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, portal]);

  if (failed) {
    return (
      <div className="grid min-h-60 place-items-center rounded-2xl bg-surface-alt text-sm text-ink-3">
        The file couldn’t be loaded.
      </div>
    );
  }
  if (!file) {
    return (
      <div className="grid min-h-60 place-items-center rounded-2xl bg-surface-alt">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    );
  }

  const isPdf = kind === "pdf" || file.type === "application/pdf";
  const isWord = kind === "word" || file.type.includes("wordprocessingml");

  if (isPdf) {
    return (
      <div className="space-y-3">
        <iframe src={file.url} title={name} className="h-[60vh] w-full rounded-2xl border border-line bg-surface-alt" />
        <a href={file.url} target="_blank" rel="noreferrer" className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-surface px-5 text-sm font-semibold text-ink ring-1 ring-line-strong transition hover:bg-surface-alt hover:ring-ink-3">
          <ExternalLink className="size-4" /> Open in a new tab
        </a>
      </div>
    );
  }

  if (isWord) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-surface-alt p-8 text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-info-soft text-info">
          <FileText className="size-8" />
        </div>
        <div>
          <p className="font-bold text-ink">.docx file uploaded</p>
          <p className="mt-1 text-sm text-ink-3">Download it to open it in Word or Pages.</p>
        </div>
        <a href={file.url} download={`${name}.docx`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-surface px-5 text-sm font-semibold text-ink ring-1 ring-line-strong transition hover:bg-surface-alt hover:ring-ink-3">
          <Download className="size-4" /> Download document
        </a>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="overflow-hidden rounded-2xl bg-surface-alt"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- blob URL of a private file */}
      <img src={file.url} alt={name} className="mx-auto max-h-[62vh] w-auto object-contain" />
    </motion.div>
  );
}
