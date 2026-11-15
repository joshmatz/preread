import React, { useState } from "react";
import { ArrowRight, Check, MessageSquare } from "lucide-react";
import type { BriefAnswer, BriefCommand, BriefFeedback, QuestionBlock } from "./brief-types";
import { feedbackBody } from "./brief-feedback";

export function BriefQuestion({ block, revision, saved, saving, onSave, subject = "feature" }: {
  block: QuestionBlock; revision: string; saved?: Extract<BriefFeedback, { kind: "answer" }>; subject?: string;
  saving: boolean; onSave: (command: BriefCommand) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const recommended = block.options.find((option) => option.recommended);
  // Without a recommendation nothing is pre-selected, so the first option never reads as advice.
  const [draft, setDraft] = useState<BriefAnswer | null>(saved?.answer ?? (recommended ? { kind: "option", option: recommended.id } : null));
  const [custom, setCustom] = useState(saved?.answer.kind === "custom" ? saved.answer.text : "");
  return <section className="brief-question" aria-labelledby={`question-${block.id}`}>
    <div className="brief-kicker"><MessageSquare size={14} /> Answer requested</div>
    <div data-brief-text={block.id}><h3 id={`question-${block.id}`}>{block.question}</h3>{block.description && <p>{block.description}</p>}</div>
    {saved && !editing ? <>
      <div className="brief-answer"><Check size={15} /><span>{feedbackBody(saved)}</span></div>
      <div className="brief-question-footer"><small>Saved in this {subject}’s feedback.</small><button className="brief-secondary" onClick={() => { setDraft(saved.answer); setCustom(saved.answer.kind === "custom" ? saved.answer.text : custom); setEditing(true); }}>Change answer</button></div>
    </> : <form onSubmit={async (event) => {
      event.preventDefault();
      if (!draft) return;
      if (await onSave({ kind: "answer", block: block.id, revision, answer: draft.kind === "custom" ? { kind: "custom", text: custom.trim() } : draft })) setEditing(false);
    }}>
      <fieldset disabled={saving}><legend className="sr-only">Choose an answer</legend>
        {block.options.map((option) => <label className="brief-choice" key={option.id}>
          <input type="radio" name={`answer-${block.id}`} checked={draft?.kind === "option" && draft.option === option.id} onChange={() => setDraft({ kind: "option", option: option.id })} />
          <span><strong>{option.label}{option.recommended && <span className="brief-recommended"> Recommended</span>}</strong>{option.description && <small>{option.description}</small>}</span>
        </label>)}
        <div className="brief-choice brief-custom-choice"><input type="radio" name={`answer-${block.id}`} checked={draft?.kind === "custom"} aria-label="Write a different answer" onChange={() => setDraft({ kind: "custom", text: custom })} />
          <label className="sr-only" htmlFor={`custom-${block.id}`}>Your own answer</label>
          <input id={`custom-${block.id}`} type="text" placeholder="Or write your own answer…" value={custom} required={draft?.kind === "custom"} maxLength={4000}
            onChange={(event) => { setCustom(event.target.value); setDraft({ kind: "custom", text: event.target.value }); }} />
        </div>
      </fieldset>
      <div className="brief-question-footer"><small>{draft ? "The suggestion isn’t submitted until you save." : "Choose an option or write your own."}</small><button className="primary" disabled={saving || !draft} type="submit">{saving ? "Saving…" : "Save answer"}<ArrowRight size={14} /></button></div>
    </form>}
  </section>;
}
