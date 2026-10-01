import type { CatalogModelView } from "@/lib/contract";
import { money } from "./client";
import s from "./model.module.css";

/** The video models from the catalog in plain words, with the cost per clip; models that can't take this slide are greyed out. */
export function ModelSelector({ models, value, onChange, name }: {
  models: CatalogModelView[];
  value: string;
  onChange: (modelId: string) => void;
  name: string;
}) {
  return (
    <ul className={s.models} role="radiogroup" aria-label="Video model">
      {models.filter((model) => model.enabled).map((model) => {
        const blocked = model.fit?.ok === false;
        const id = `${name}-${model.id}`;
        return (
          <li key={model.id} className={`${s.model} ${value === model.id ? s.modelSelected : ""} ${blocked ? s.modelBlocked : ""}`}>
            <label htmlFor={id}>
              <input id={id} type="radio" name={name} value={model.id} checked={value === model.id} disabled={blocked}
                onChange={() => onChange(model.id)} aria-describedby={`${id}-detail`} />
              <span className={s.modelText}>
                <span className={s.modelName}>
                  <strong>{model.label}</strong>
                  {model.isDefault && !/recommended/i.test(model.label) && <span className={s.badge}>Recommended</span>}
                  <span className={s.price}>about {money(model.estimatedClipUsd)} a clip</span>
                </span>
                <span id={`${id}-detail`} className={s.modelDetail}>
                  {model.description}
                  {model.fit?.reason && <span className={blocked ? s.fitBlocked : s.fitNote}>{model.fit.reason}</span>}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
