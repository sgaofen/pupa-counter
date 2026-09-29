import React from "react";
import type { ScanMeta } from "../types";
import { useSettings } from "../store/settingsStore";

interface Props {
  meta: ScanMeta;
  onChange: (m: Partial<ScanMeta>) => void;
  idPrefix: string;
}

/** Labels for a scan. Values carry over to the next scan of the same
 *  replicate; a new replicate starts from the defaults. */
export function MetaForm({ meta, onChange, idPrefix }: Props) {
  const genotypes = useSettings((s) => s.genotypes);
  const inList = genotypes.includes(meta.genotype);
  return (
    <div className="meta-form">
      <div className="field">
        <label htmlFor={`${idPrefix}-genotype`}>Genotype</label>
        <div className="chips" role="group" aria-label="Genotype">
          {genotypes.map((g) => (
            <button key={g} type="button" className={`chip${meta.genotype === g ? " on" : ""}`}
              onClick={() => onChange({ genotype: g })}>{g}</button>
          ))}
        </div>
        <input id={`${idPrefix}-genotype`} className="input" value={meta.genotype}
          placeholder="Type any genotype"
          onChange={(e) => onChange({ genotype: e.target.value })} />
        {!inList && meta.genotype && (
          <span className="hint">Not in your list. Add it under Settings → Genotypes to keep it as a button.</span>
        )}
      </div>
      <div className="two">
        <div className="field">
          <label htmlFor={`${idPrefix}-operator`}>Operator</label>
          <input id={`${idPrefix}-operator`} className="input" value={meta.operator}
            onChange={(e) => onChange({ operator: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-file`}>Info filename</label>
          <input id={`${idPrefix}-file`} className="input mono" value={meta.infoFilename}
            onChange={(e) => onChange({ infoFilename: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-experiment`}>Experiment</label>
        <input id={`${idPrefix}-experiment`} className="input" value={meta.experiment}
          onChange={(e) => onChange({ experiment: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-comments`}>Comments</label>
        <textarea id={`${idPrefix}-comments`} className="textarea" value={meta.comments}
          placeholder="e.g. control, vial 3"
          onChange={(e) => onChange({ comments: e.target.value })} />
      </div>
    </div>
  );
}
