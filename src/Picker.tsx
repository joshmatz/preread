import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

interface Option {
  value: string;
  label: string;
  detail?: string;
  complete?: boolean;
}
interface Props {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  searchable?: boolean;
  placeholder?: string;
  className?: string;
}
export function Picker({
  label,
  value,
  options,
  onChange,
  searchable = false,
  placeholder = "Choose…",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 300, maxHeight: 400 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) =>
    `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const choose = (option: Option) => {
    onChange(option.value);
    close();
  };
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current!.getBoundingClientRect();
      const width = Math.min(
        Math.max(bounds.width, searchable ? 420 : 220),
        window.innerWidth - 24,
      );
      const below = window.innerHeight - bounds.bottom - 16;
      const above = bounds.top - 16;
      const flip = below < 240 && above > below;
      const maxHeight = Math.min(440, Math.max(100, flip ? above : below));
      setPosition({
        left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
        top: flip ? bounds.top - maxHeight - 6 : bounds.bottom + 6,
        width,
        maxHeight,
      });
    };
    place();
    if (searchable) input.current?.focus();
    else list.current?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        close(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
    };
  }, [open, searchable]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") close();
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) =>
        Math.max(0, Math.min(filtered.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))),
      );
    } else if (!searchable && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : filtered.length - 1);
    } else if (event.key === "Enter" || (!searchable && event.key === " ")) {
      event.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    }
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`picker-trigger ${className}`}
        aria-label={`${label}: ${selected?.label ?? placeholder}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => {
          if (open) close();
          else {
            setQuery("");
            setActive(
              Math.max(
                0,
                options.findIndex((option) => option.value === value),
              ),
            );
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setQuery("");
            setActive(
              Math.max(
                0,
                options.findIndex((option) => option.value === value),
              ),
            );
            setOpen(true);
          }
        }}
      >
        <span>{selected?.label ?? placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div className="picker-panel" ref={panel} style={position} onKeyDown={keys}>
            {searchable && (
              <label className="picker-search">
                <Search size={15} />
                <input
                  type="search"
                  autoComplete="off"
                  data-1p-ignore
                  ref={input}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  placeholder={`Find ${label.toLowerCase()}…`}
                  aria-label={`Search ${label.toLowerCase()}`}
                  role="combobox"
                  aria-expanded="true"
                  aria-autocomplete="list"
                  aria-controls={`${id}-list`}
                  aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined}
                />
              </label>
            )}
            <div
              ref={list}
              className="picker-options"
              id={`${id}-list`}
              role="listbox"
              aria-label={label}
              tabIndex={searchable ? undefined : -1}
              aria-activedescendant={
                !searchable && filtered[active] ? `${id}-${active}` : undefined
              }
            >
              {filtered.map((option, index) => (
                <div
                  key={option.value}
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  className={`picker-option ${index === active ? "focused" : ""}`}
                  onPointerMove={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span className={`picker-check ${option.complete ? "completed" : ""}`}>
                    {(option.value === value || option.complete) && <Check size={15} />}
                  </span>
                  <div>
                    <strong>{option.label}</strong>
                    {option.detail && (
                      <small className={option.complete ? "completed" : ""}>{option.detail}</small>
                    )}
                  </div>
                </div>
              ))}
              {!filtered.length && <p className="picker-empty">No matches</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
