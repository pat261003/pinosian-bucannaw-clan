import { createPortal } from "react-dom";
import React, { useState, useEffect, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  Heart,
  Plus,
  Minus,
  Maximize,
} from "lucide-react";
import {
  TransformWrapper,
  TransformComponent,
  useControls,
} from "react-zoom-pan-pinch";
const name = (p) =>
  p?.full_name ||
  [p?.first_name, p?.middle_name, p?.last_name, p?.suffix]
    .filter(Boolean)
    .join(" ") ||
  `Unknown member · ${p?.id?.slice(0, 8)}`;
export default function HierarchyTree({
  root,
  selected,
  ancestors = [],
  style,
  version,
  api,
  focus,
}) {
  if (!root)
    return <p className="field-help">No clan heads have been recorded.</p>;
  const props = {
    person: root,
    selected,
    ancestors,
    version,
    api,
    focus,
    depth: 0,
    path: [],
    outline: style === "outline",
  };
  return (
    <section className="hierarchy-view">
      <p className="hierarchy-help">
        {style === "outline"
          ? "Open the arrows to see children, then their children. Select a name to view or edit that person."
          : "Clan heads stay at the top. Open a family to see the next generation below it. Partners’ children are kept in separate groups."}
      </p>
      {style === "outline" ? (
        <div className="outline-scroll">
          <HierarchyPerson {...props} />
        </div>
      ) : (
        <TransformWrapper
          initialScale={0.75}
          minScale={0.15}
          maxScale={2}
          limitToBounds={false}
          centerOnInit={false}
          initialPositionX={20}
          initialPositionY={20}
          doubleClick={{ disabled: true }}
          panning={{ excluded: ["button"] }}
        >
          <HierarchyControls />
          <TransformComponent
            wrapperClass="canvas hierarchy-canvas"
            contentClass="canvas-content hierarchy-content"
          >
            <HierarchyPerson {...props} />
          </TransformComponent>
        </TransformWrapper>
      )}
    </section>
  );
}
function HierarchyControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="hierarchy-zoom">
      <button aria-label="Zoom in" onClick={() => zoomIn(0.5, 0)}>
        <Plus size={18} />
      </button>
      <button aria-label="Zoom out" onClick={() => zoomOut(0.5, 0)}>
        <Minus size={18} />
      </button>
      <button aria-label="Center tree" onClick={() => resetTransform(0)}>
        <Maximize size={18} />
      </button>
    </div>
  );
}
function PersonButton({ person, focus, selected, outline }) {
  return (
    <button
      className={
        (outline ? "outline-name" : "tree-node") +
        (person.id === selected ? " current" : "")
      }
      onClick={() => focus(person.id)}
      aria-label={"View " + name(person)}
    >
      <strong>{name(person)}</strong>
      {!outline && (
        <span>
          {person.birth_date?.slice(0, 4) || "Birth date unknown"} ·{" "}
          {person.gender}
        </span>
      )}
    </button>
  );
}
function HierarchyPerson(props) {
  const {
    person,
    selected,
    ancestors,
    version,
    api,
    focus,
    depth,
    path,
    outline,
  } = props;
  const [open, setOpen] = useState(depth < (outline ? 1 : 2)),
    [detail, setDetail] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (ancestors.includes(person.id) || selected === person.id) setOpen(true);
  }, [selected, ancestors.join(",")]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    api("/persons/" + person.id)
      .then((p) => {
        if (active) {
          setDetail(p);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [open, person.id, version]);
  if (path.includes(person.id)) return null;
  const headPartner =
    depth === 0 ? detail?.families.find((f) => f.partner)?.partner : null;
  return (
    <div
      className={outline ? "outline-person" : "generation-person"}
      data-person-id={person.id}
      data-generation={depth + 1}
    >
      <div className="hierarchy-person-heading">
        <button
          className="branch-toggle"
          aria-expanded={open}
          aria-label={
            (open ? "Collapse" : "Expand") + " family of " + name(person)
          }
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <div className="hierarchy-person-label">
          {!outline && (
            <span className="generation-label">
              {depth === 0 ? "Clan heads" : "Generation " + (depth + 1)}
            </span>
          )}
          <div className="hierarchy-person-pair">
            <PersonButton
              person={detail || person}
              {...{ focus, selected, outline }}
            />
            {headPartner && (
              <>
                <Heart size={15} />
                <PersonButton
                  person={headPartner}
                  {...{ focus, selected, outline }}
                />
              </>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div className="hierarchy-branches">
          {error ? (
            <p role="alert" className="error">
              {error}
              <button
                onClick={() => {
                  setOpen(false);
                  setTimeout(() => setOpen(true), 0);
                }}
              >
                Retry
              </button>
            </p>
          ) : !detail ? (
            <p className="muted">Loading family…</p>
          ) : detail.families.length ? (
            detail.families.map((f) => (
              <HierarchyFamily
                key={f.id || "single"}
                {...props}
                detail={detail}
                family={f}
                path={[...path, person.id]}
              />
            ))
          ) : (
            <p className="hierarchy-empty">No children or partners recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}
function HierarchyFamily(props) {
  const { person, detail, family, api, version, depth, outline } = props;
  const [result, setResult] = useState(null),
    [offset, setOffset] = useState(0),
    [ordering, setOrdering] = useState(null),
    [saving, setSaving] = useState(false),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(
      `/persons/${person.id}/children?union=${family.id || "single"}&offset=${offset}&limit=12`,
    )
      .then((r) => {
        if (active) {
          setResult(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [person.id, family.id, version, offset, refresh]);
  return (
    <div className="hierarchy-family" data-union={family.id || "single"}>
      <div className="family-group-label">
        {depth === 0 ? (
          "Children of both clan heads"
        ) : family.partner ? (
          <span>
            Children with{" "}
            <button onClick={() => props.focus(family.partner.id)}>
              {name(family.partner)}
            </button>
          </span>
        ) : (
          "Children · other parent unknown"
        )}
        <small>
          {family.child_count} {family.child_count === 1 ? "child" : "children"}
        </small>
      </div>
      {family.child_count > 1 && (
        <button
          className="arrange-button"
          onClick={async () => {
            try {
              const first = await api(
                `/persons/${person.id}/children?union=${family.id || "single"}&limit=100`,
              );
              if (first.total > 500)
                throw new Error(
                  "This family is too large to arrange in one list.",
                );
              const rows = [...first.items];
              for (let n = 100; n < first.total; n += 100)
                rows.push(
                  ...(
                    await api(
                      `/persons/${person.id}/children?union=${family.id || "single"}&limit=100&offset=${n}`,
                    )
                  ).items,
                );
              setOrdering(rows);
              setError("");
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Arrange children
        </button>
      )}
      {ordering && (
        <OrderDialog
          close={() => {
            if (!saving) {
              setOrdering(null);
              setError("");
            }
          }}
        >
          <strong>Oldest child first</strong>
          <p>
            Use the arrows when you know the birth order, even without
            birthdays. Your saved order takes priority; new children appear
            after it.
          </p>
          <ol>
            {ordering.map((child, i) => (
              <li key={child.id}>
                <span>{name(child)}</span>
                <button
                  disabled={saving || i === 0}
                  aria-label={`Move ${name(child)} earlier`}
                  onClick={() =>
                    setOrdering((rows) => {
                      const next = [...rows];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      return next;
                    })
                  }
                >
                  ↑
                </button>
                <button
                  disabled={saving || i === ordering.length - 1}
                  aria-label={`Move ${name(child)} later`}
                  onClick={() =>
                    setOrdering((rows) => {
                      const next = [...rows];
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      return next;
                    })
                  }
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <p>
            Automatic order: known birthdays, oldest first; then unknown
            birthdays in entry order. Equal birthdays use entry order.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="order-actions">
            {[false, true].map((automatic) => (
              <button
                key={String(automatic)}
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setError("");
                  try {
                    await api(`/persons/${person.id}/child-order`, {
                      method: "PUT",
                      body: JSON.stringify({
                        union_id: family.id,
                        child_ids: ordering.map((c) => c.id),
                        automatic,
                      }),
                    });
                    setOrdering(null);
                    setOffset(0);
                    setRefresh((n) => n + 1);
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {automatic ? "Use automatic order" : "Save birth order"}
              </button>
            ))}
            <button
              disabled={saving}
              onClick={() => {
                setOrdering(null);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </OrderDialog>
      )}
      {error && !ordering ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : result ? (
        <>
          <div className={outline ? "outline-children" : "generation-children"}>
            {result.items.map((child) => (
              <HierarchyPerson
                key={child.id}
                {...props}
                person={child}
                depth={depth + 1}
              />
            ))}
          </div>
          {!result.total && (
            <p className="hierarchy-empty">No children recorded.</p>
          )}
          {result.total > 12 && (
            <div className="pager">
              <button
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 12))}
              >
                Previous children
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 12, result.total)} of{" "}
                {result.total}
              </span>
              <button
                disabled={offset + 12 >= result.total}
                onClick={() => setOffset(offset + 12)}
              >
                More children
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="muted">Loading children…</p>
      )}
    </div>
  );
}

function OrderDialog({ children, close }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="child-order-modal"
      aria-label="Arrange children"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <section className="child-order-editor">{children}</section>
    </dialog>,
    document.body,
  );
}
