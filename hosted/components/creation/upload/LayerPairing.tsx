"use client";

import { useState } from "react";

import Icon from "@/components/carousel/Icons";
import { backgroundOnly, describeFile, type FileRole, type LayerPair, type RejectedFile, type UnpairedFile } from "./pairing";
import u from "./upload.module.css";

const ALONE = "__alone__";
const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

type Props = {
  unpaired: UnpairedFile[];
  rejected: RejectedFile[];
  onPair: (pair: LayerPair, used: File[]) => void;
  onDismiss: (file: File) => void;
};

/** Files that didn't find their partner by name. The creator matches them by hand, or uses a background alone. */
export function LayerPairing({ unpaired, rejected, onPair, onDismiss }: Props) {
  if (!unpaired.length && !rejected.length) return null;
  return (
    <section className={u.pairing} aria-labelledby="pairing-heading">
      <h2 id="pairing-heading">
        {unpaired.length ? `${unpaired.length} ${unpaired.length === 1 ? "file needs" : "files need"} a partner` : "Some files can't be used"}
      </h2>
      {unpaired.length > 0 && (
        <p className={u.pairingIntro}>
          Name pairs like <code>potty-background.jpg</code> and <code>potty-text.png</code> and they pair themselves.
          You can also match these by hand.
        </p>
      )}
      <ul className={u.pairingList}>
        {unpaired.map((item) => (
          <PairRow key={fileKey(item.file)} item={item} others={unpaired.filter((other) => other.file !== item.file)}
            onPair={onPair} onDismiss={onDismiss} />
        ))}
        {rejected.map((item) => (
          <li key={fileKey(item.file)} className={u.pairRejected}>
            <span className={u.pairName}><Icon name="alert" size={14} /> {item.file.name}</span>
            <span className={u.pairReason}>{item.reason}</span>
            <button className={u.linkButton} onClick={() => onDismiss(item.file)}>Dismiss</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PairRow({ item, others, onPair, onDismiss }: {
  item: UnpairedFile;
  others: UnpairedFile[];
  onPair: Props["onPair"];
  onDismiss: Props["onDismiss"];
}) {
  const [role, setRole] = useState<Exclude<FileRole, "unknown">>(item.role === "text" ? "text" : "background");
  const [partner, setPartner] = useState("");
  const [error, setError] = useState("");
  const id = fileKey(item.file);
  const add = () => {
    setError("");
    if (partner === ALONE) {
      onPair(backgroundOnly(item.file), [item.file]);
      return;
    }
    const other = others.find((candidate) => fileKey(candidate.file) === partner)?.file;
    if (!other) return;
    const background = role === "background" ? item.file : other;
    const text = role === "background" ? other : item.file;
    if (text.type !== "image/png") {
      setError("The text layer must be a PNG with transparency.");
      return;
    }
    const name = describeFile(background.name).stem;
    onPair({ key: `manual:${name.toLowerCase()}:${background.name}:${text.name}`, name, background, text }, [item.file, other]);
  };
  return (
    <li className={u.pairRow}>
      <span className={u.pairName}>{item.file.name}</span>
      <span className={u.pairReason}>{item.reason}</span>
      <span className={u.pairControls}>
        <label>
          <span className={u.visuallyHidden}>Role of {item.file.name}</span>
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)} disabled={item.role !== "unknown"}>
            <option value="background">Background</option>
            <option value="text">Text layer</option>
          </select>
        </label>
        <label>
          <span className={u.visuallyHidden}>Partner for {item.file.name}</span>
          <select value={partner} onChange={(event) => setPartner(event.target.value)} aria-describedby={error ? `${id}-error` : undefined}>
            <option value="">Pair with…</option>
            {role === "background" && <option value={ALONE}>No text layer (use alone)</option>}
            {others.filter((other) => other.role !== role).map((other) => (
              <option key={fileKey(other.file)} value={fileKey(other.file)}>{other.file.name}</option>
            ))}
          </select>
        </label>
        <button className={u.smallPrimary} onClick={add} disabled={!partner}>Add slide</button>
        <button className={u.linkButton} onClick={() => onDismiss(item.file)}>Remove</button>
      </span>
      {error && <p id={`${id}-error`} className={u.pairError} role="alert">{error}</p>}
    </li>
  );
}
