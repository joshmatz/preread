import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

type Bind = (content: () => ReactNode) => {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
};
interface Card {
  anchor: HTMLElement;
  content: ReactNode;
  focused: boolean;
}
const BindContext = createContext<Bind>(() => ({
  onPointerEnter() {},
  onPointerLeave() {},
  onFocus() {},
  onBlur() {},
}));
export const useHoverCard = () => useContext(BindContext);

// Hidden from assistive tech, so anchors must carry the same facts in their labels.
export function HoverCards({ children }: { children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [controls] = useState(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Card | null = null;
    let warmUntil = 0;
    const set = (next: Card | null) => {
      current = next;
      setCard(next);
    };
    const hide = (warm = false) => {
      clearTimeout(timer);
      if (!current) return;
      if (warm) warmUntil = performance.now() + 400;
      set(null);
    };
    const hideSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => hide(true), 150);
    };
    const show = (anchor: HTMLElement, content: () => ReactNode, focused: boolean) => {
      if (!anchor.isConnected) return;
      const node = content();
      if (node) set({ anchor, content: node, focused });
      else hide(true);
    };
    const place = () => {
      const panel = element.current;
      if (!current || !panel) return;
      if (!current.anchor.isConnected) return hide();
      const bounds = current.anchor.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(bounds.right + 12, innerWidth - panel.offsetWidth - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(bounds.top - 3, innerHeight - panel.offsetHeight - 8))}px`;
    };
    const bind: Bind = (content) => ({
      onPointerEnter(event) {
        if (event.pointerType !== "mouse") return;
        clearTimeout(timer);
        const anchor = event.currentTarget;
        if (current || performance.now() < warmUntil) show(anchor, content, false);
        else timer = setTimeout(() => show(anchor, content, false), 400);
      },
      onPointerLeave(event) {
        if (event.pointerType === "mouse" && !current?.focused) hideSoon();
      },
      onFocus(event) {
        if (!event.currentTarget.matches(":focus-visible")) return;
        clearTimeout(timer);
        show(event.currentTarget, content, true);
      },
      onBlur() {
        if (current?.focused) hide();
      },
    });
    return { bind, hide, hideSoon, place, keep: () => clearTimeout(timer), current: () => current };
  });
  useLayoutEffect(() => {
    const panel = element.current!;
    if (!card) {
      if (panel.matches(":popover-open")) panel.hidePopover();
      return;
    }
    if (!panel.matches(":popover-open")) panel.showPopover();
    controls.place();
  }, [card, controls]);
  useEffect(() => {
    const panel = element.current!;
    // A refresh can remove the anchor without a pointerleave, so any later input checks it.
    const stale = () => controls.current()?.anchor.isConnected === false;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" || stale()) controls.hide();
    };
    const press = (event: Event) => {
      if (!panel.contains(event.target as Node)) controls.hide();
    };
    // Tab scrolls a focused row into view; only a pointer's card goes stale when the page moves.
    const scroll = (event: Event) => {
      if (panel.contains(event.target as Node)) return;
      if (controls.current()?.focused) controls.place();
      else controls.hide();
    };
    const move = () => {
      if (stale()) controls.hide();
    };
    addEventListener("keydown", key, true);
    addEventListener("pointerdown", press, true);
    addEventListener("scroll", scroll, true);
    addEventListener("pointermove", move, true);
    addEventListener("resize", controls.place);
    return () => {
      controls.keep();
      removeEventListener("keydown", key, true);
      removeEventListener("pointerdown", press, true);
      removeEventListener("scroll", scroll, true);
      removeEventListener("pointermove", move, true);
      removeEventListener("resize", controls.place);
    };
  }, [controls]);
  return (
    <BindContext value={controls.bind}>
      {children}
      <div
        ref={element}
        popover="manual"
        className="popover hover-card"
        aria-hidden="true"
        onPointerEnter={controls.keep}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" && !controls.current()?.focused) controls.hideSoon();
        }}
      >
        {card?.content}
      </div>
    </BindContext>
  );
}

export function WrappablePath({ path }: { path: string }) {
  return path.split(/(?<=\/)/).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      <span className="path-part">{part}</span>
    </Fragment>
  ));
}
