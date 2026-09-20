"use client";

import {
  SINGAPORE_VIDEO_MODELS,
  getVideoModelContract,
  type ModelAcknowledgement,
  type VideoTask,
} from "@/lib/video-catalog";

const familyLabel: Record<VideoTask, string> = {
  "text-to-video": "Text to video",
  "image-to-video": "Image to video",
  "keyframe-to-video": "First and last frame video",
  "reference-to-video": "Reference to video",
  "video-edit": "Video editing",
  "animate-move": "Image to action",
  "animate-mix": "Video character swap",
};

export function ModelPicker({
  selectedId,
  acknowledgements,
  onChange,
  onAcknowledge,
}: {
  selectedId: string;
  acknowledgements: readonly ModelAcknowledgement[];
  onChange: (modelId: string) => void;
  onAcknowledge: (model: { id: string; contractVersion: string }) => void;
}) {
  const selected = getVideoModelContract(selectedId) ?? SINGAPORE_VIDEO_MODELS[0];
  const acknowledged = acknowledgements.some((acknowledgement) => (
    acknowledgement.modelId === selected.id
    && acknowledgement.contractVersion === selected.contractVersion
  ));

  return (
    <div className="model-picker">
      <label>
        Model and capability
        <select value={selected.id} onChange={(event) => onChange(event.target.value)}>
          {Object.entries(familyLabel).map(([task, label]) => (
            <optgroup key={task} label={label}>
              {SINGAPORE_VIDEO_MODELS.filter((model) => model.task === task).map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {acknowledged ? (
        <p className="note">Billing acknowledgement recorded for this model contract.</p>
      ) : (
        <div className="acknowledgement">
          <p className="note">Alibaba billing and free quota are controlled in Model Studio. This model can incur charges after its available quota is used.</p>
          <button type="button" onClick={() => onAcknowledge(selected)}>Acknowledge model billing</button>
        </div>
      )}
    </div>
  );
}
