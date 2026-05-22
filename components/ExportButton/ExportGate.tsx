'use client';

import { useState } from 'react';
import { labels } from '@/lib/labels';
import styles from './ExportGate.module.css';

const PASSPHRASE_HASH = process.env.NEXT_PUBLIC_EXPORT_PASSPHRASE_HASH ?? '';

export const EXPORT_TOKEN_KEY = 'efficiency-dashboard:exportToken';

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface Props {
  open: boolean;
  onClose: () => void;
  onUnlock: () => void;
  onCurrentView: () => void;
}

export function ExportGate({ open, onClose, onUnlock, onCurrentView }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  if (!open) return null;

  async function handleConfirm() {
    setError(false);
    const hash = await sha256Hex(value);
    if (PASSPHRASE_HASH && hash === PASSPHRASE_HASH) {
      try { localStorage.setItem(EXPORT_TOKEN_KEY, '1'); } catch {}
      onUnlock();
    } else {
      setError(true);
    }
  }

  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-labelledby="export-gate-title">
      <div className={styles.modal}>
        <div className={styles.title} id="export-gate-title">{labels.exportGate.title}</div>
        <div className={styles.body}>{labels.exportGate.body}</div>
        <input
          type="password"
          className={styles.input}
          placeholder={labels.exportGate.inputPlaceholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        {error && <div className={styles.error}>{labels.exportGate.error}</div>}
        <div className={styles.row}>
          <button type="button" className={styles.secondary} onClick={onCurrentView}>
            {labels.table.exportXlsx}
          </button>
          <button type="button" className={styles.secondary} onClick={onClose}>
            {labels.exportGate.cancel}
          </button>
          <button type="button" className={styles.primary} onClick={handleConfirm}>
            {labels.exportGate.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
