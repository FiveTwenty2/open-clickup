"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/lib/api";

type ImportResult = { count: number; errors: string[]; imported: boolean };
const button = "rounded border border-cu-border px-3 py-1.5 text-sm hover:bg-cu-hover disabled:opacity-50";

export function CsvImportDialog({ listId, onClose }: { listId: string; onClose: () => void }) {
  const [csv, setCsv] = useState("");
  const [fileError, setFileError] = useState("");
  const [result, setResult] = useState<ImportResult>();
  const client = useQueryClient();
  const upload = useMutation({
    mutationFn: (preview: boolean) => apiSend<ImportResult>(`/api/lists/${listId}/csv`, "POST", { csv, preview }),
    onSuccess: (data) => {
      setResult(data);
      if (data.imported) {
        void client.invalidateQueries({ queryKey: ["list", listId] });
        void client.invalidateQueries({ queryKey: ["bootstrap"] });
      }
    },
  });

  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[51] max-h-[85vh] w-[min(580px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-cu-panel p-5 shadow-xl">
        <Dialog.Title className="text-lg font-semibold">Import tasks from CSV</Dialog.Title>
        <Dialog.Description className="my-3 text-sm text-cu-text-secondary">
          Include a Task Name column. Optional columns are Status, Priority, Assignees, Start Date, Due Date, Description, Task ID and Parent Task ID.
        </Dialog.Description>
        <label className="grid gap-2 text-sm">CSV file
          <input type="file" accept=".csv,text/csv" disabled={upload.isPending} onChange={async (event) => {
            const file = event.target.files?.[0];
            setCsv("");
            setFileError("");
            setResult(undefined);
            upload.reset();
            if (!file) return;
            if (file.size > 2_000_000) { setFileError("Choose a CSV file smaller than 2 MB."); return; }
            try { setCsv(await file.text()); } catch { setFileError("Could not read this CSV file."); }
          }} />
        </label>
        {fileError && <p role="alert" className="mt-3 text-sm text-cu-urgent">{fileError}</p>}
        {upload.isError && <p role="alert" className="mt-3 text-sm text-cu-urgent">{upload.error.message.split('"error":"')[1]?.split('"')[0] ?? "Could not process this CSV file."}</p>}
        {result && <div aria-live="polite" className="my-3 text-sm">
          <p>{result.imported ? `Imported ${result.count} tasks.` : `${result.count} task rows read.`}</p>
          {result.errors.length > 0 && <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-cu-urgent">
            {result.errors.map((error, index) => <li key={index}>{error}</li>)}
          </ul>}
        </div>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Dialog.Close className={button}>Close</Dialog.Close>
          {!result?.imported && <button className={button} disabled={!csv || upload.isPending} onClick={() => upload.mutate(true)}>Validate CSV</button>}
          {result && !result.errors.length && !result.imported && <button className={button + " bg-cu-purple text-white"} disabled={upload.isPending} onClick={() => upload.mutate(false)}>Import {result.count} tasks</button>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
