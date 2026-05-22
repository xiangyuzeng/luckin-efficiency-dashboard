'use client';

import { useEffect, useState } from 'react';
import { labels } from '@/lib/labels';
import { ExportGate, EXPORT_TOKEN_KEY } from './ExportGate';

interface Props {
  // Per-grain/per-table export. The callback is invoked with which sheets to export.
  onExportCurrentView: () => void;
  onExportFull: () => void;
  // When `true`, the full export requires a passphrase gate; current-view export stays open.
  requireAuthForFullExport: boolean;
}

export function ExportButton({ onExportCurrentView, onExportFull, requireAuthForFullExport }: Props) {
  const [gateOpen, setGateOpen] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  // Remember a successful unlock across sessions so users aren't re-prompted.
  useEffect(() => {
    try { setHasToken(localStorage.getItem(EXPORT_TOKEN_KEY) === '1'); } catch {}
  }, []);

  function handleClick() {
    if (requireAuthForFullExport && !hasToken) {
      setGateOpen(true);
    } else {
      onExportFull();
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick}>
        {labels.filter.exportData}
      </button>
      <ExportGate
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        onUnlock={() => {
          setGateOpen(false);
          setHasToken(true);
          onExportFull();
        }}
        onCurrentView={() => {
          setGateOpen(false);
          onExportCurrentView();
        }}
      />
    </>
  );
}
